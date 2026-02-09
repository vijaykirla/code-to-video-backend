/**
 * Remotion Renderer Web API
 *
 * Fastify server that accepts TSX code and renders it to MP4
 *
 * POST /render
 *   Body: { tsx: "...tsx code...", filename?: "output.mp4" }
 *   Returns: MP4 video file
 */

const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const fastifyStatic = require("@fastify/static");
const path = require("path");
const fs = require("fs").promises;
const { existsSync } = require("fs");
const { randomUUID } = require("crypto");
const { bundle } = require("@remotion/bundler");
const {
  renderMedia,
  selectComposition,
  ensureBrowser,
} = require("@remotion/renderer");

// You'll need to create these lib files or adjust imports based on your setup
const { extractCompositionConfig } = require("./lib/config-extractor");
const { createTempProject, cleanupTempProject } = require("./lib/temp-project");

// Configuration
const TEMP_DIR = path.join(__dirname, "temp");
const OUTPUT_DIR = path.join(__dirname, "outputs");
const MAX_TSX_SIZE = 1024 * 1024; // 1MB limit for TSX code

// Serves files from the 'public' directory
// Files will be accessible under the '/public' URL prefix
fastify.register(fastifyStatic, {
  root: path.join(__dirname, "client"),
  prefix: "/client/",
});

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

// Clean up old files (older than 1 hour)
async function cleanupOldFiles() {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  for (const dir of [TEMP_DIR, OUTPUT_DIR]) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > ONE_HOUR) {
          await fs.unlink(filePath);
        }
      }
    } catch (err) {
      console.error(`Cleanup error in ${dir}:`, err.message);
    }
  }
}

// Register CORS plugin
fastify.register(cors, {
  origin: true, // Allow all origins
  methods: ["GET", "POST", "OPTIONS"],
});

// Health check endpoint
fastify.get("/health", async (request, reply) => {
  return { status: "ok", service: "remotion-renderer" };
});

// Main render endpoint
fastify.post("/render", async (request, reply) => {
  const { tsx, filename } = request.body;

  // Validate input
  if (!tsx || typeof tsx !== "string") {
    return reply.code(400).send({
      error: "Missing or invalid tsx field",
      message:
        'Request body must include a "tsx" field with TSX code as a string',
    });
  }

  if (tsx.length > MAX_TSX_SIZE) {
    return reply.code(400).send({
      error: "TSX code too large",
      message: `TSX code must be less than ${MAX_TSX_SIZE / 1024}KB`,
    });
  }

  const jobId = randomUUID();
  const tsxFilePath = path.join(TEMP_DIR, `${jobId}.tsx`);
  const outputFileName = filename || `${jobId}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFileName);

  let tempProjectDir = null;

  try {
    // Write TSX to temporary file
    await fs.writeFile(tsxFilePath, tsx, "utf-8");
    request.log.info({ jobId }, "TSX file created");

    // Extract composition config
    let config;
    try {
      config = extractCompositionConfig(tsxFilePath);
      request.log.info({ jobId, config }, "Composition config extracted");
    } catch (err) {
      return reply.code(400).send({
        error: "Invalid composition config",
        message:
          "TSX must export a compositionConfig object with id, durationInSeconds, fps, width, and height",
        details: err.message,
      });
    }

    // Ensure browser is available
    await ensureBrowser({ logLevel: "error" });
    request.log.info({ jobId }, "Browser ready");

    // Create temporary project
    tempProjectDir = createTempProject(tsxFilePath, config);
    request.log.info({ jobId, tempProjectDir }, "Temporary project created");

    // Bundle the project
    const entryPoint = path.join(tempProjectDir, "src", "index.ts");
    const rendererNodeModules = path.resolve(__dirname, "node_modules");

    const bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (webpackConfig) => {
        webpackConfig.resolve = webpackConfig.resolve || {};
        webpackConfig.resolve.modules = [
          rendererNodeModules,
          ...(webpackConfig.resolve.modules || ["node_modules"]),
        ];
        webpackConfig.resolveLoader = webpackConfig.resolveLoader || {};
        webpackConfig.resolveLoader.modules = [
          rendererNodeModules,
          ...(webpackConfig.resolveLoader.modules || ["node_modules"]),
        ];
        return webpackConfig;
      },
    });
    request.log.info({ jobId }, "Bundle complete");

    // Select composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: config.id,
    });
    request.log.info(
      { jobId, compositionId: composition.id },
      "Composition selected",
    );

    // Render the video
    const durationInFrames = Math.round(config.durationInSeconds * config.fps);

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames,
        fps: config.fps,
        width: config.width,
        height: config.height,
      },
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
    });

    request.log.info({ jobId, outputPath }, "Render complete");

    // Clean up temp TSX file
    await fs.unlink(tsxFilePath);

    // Send the video file
    const stream = await fs.readFile(outputPath);

    reply
      .header("Content-Type", "video/mp4")
      .header("Content-Disposition", `attachment; filename="${outputFileName}"`)
      .send(stream);
  } catch (err) {
    request.log.error({ jobId, error: err.message }, "Render failed");

    // Clean up temp files on error
    try {
      if (existsSync(tsxFilePath)) await fs.unlink(tsxFilePath);
      if (existsSync(outputPath)) await fs.unlink(outputPath);
    } catch (cleanupErr) {
      request.log.error({ error: cleanupErr.message }, "Cleanup failed");
    }

    return reply.code(500).send({
      error: "Render failed",
      message: err.message,
      jobId,
    });
  } finally {
    // Cleanup temporary project
    if (tempProjectDir) {
      cleanupTempProject(tempProjectDir);
    }
  }
});

// Cleanup job (runs every 30 minutes)
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// Start server
const start = async () => {
  try {
    await ensureDirectories();
    await ensureBrowser({ logLevel: "error" });

    const port = process.env.PORT || 3000;
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    console.log(`\n🎬 Remotion Renderer API ready at http://localhost:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health  - Health check`);
    console.log(`  POST /render  - Render TSX to MP4\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
