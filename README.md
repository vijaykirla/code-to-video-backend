# Code to Video Backend

A Fastify-based backend API that accepts TSX code and renders it to MP4 videos using Remotion. This portable renderer allows you to generate videos programmatically via a simple REST API.

## Features

- 🎬 Render TSX/React components to MP4 videos
- 🚀 RESTful API with Fastify
- 🌐 CORS enabled for cross-origin requests
- 🧹 Automatic cleanup of old renders (1 hour retention)

## Prerequisites

- Node.js version = 24.13.0
- npm or yarn

## Installation

1. Clone the repository:

```bash
git clone https://github.com/vijaykirla/code-to-video-backend.git
cd code-to-video-backend
```

2. Install dependencies:

```bash
npm install
```

## Project Structure

```
remotion-portable-renderer/
├── api-server.js           # Main Fastify server
├── lib/
│   ├── config-extractor.js # Composition config extraction
│   └── temp-project.js     # Temporary project management
├── client/                 # Static files served at /client/
├── temp/                   # Temporary TSX files (auto-created)
├── outputs/                # Rendered video outputs (auto-created)
├── package.json
└── README.md
```

## Usage

### Starting the Server

```bash
npm start
```

The server will start on `http://localhost:3000` by default.

## API Endpoints

### Health Check

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "service": "remotion-renderer"
}
```

### Render Video

```http
POST /render
```

**Request Body:**

```json
{
  "tsx": "...your TSX code...",
  "filename": "output.mp4" // optional
}
```

## Automatic Cleanup

The service automatically cleans up:

- Output files older than 1 hour (runs every 30 minutes)
- Temporary project directories after each render

## Limitations

- Maximum TSX code size: 1MB
- Files are automatically deleted after 1 hour
- Concurrent renders are supported but may impact performance

### Extending the API

To add new endpoints, modify `api-server.js`:

```javascript
fastify.post("/your-endpoint", async (request, reply) => {
  // Your logic here
});
```

## License

MIT

## Documentation

- Check [Remotion documentation](https://www.remotion.dev/docs)

## Acknowledgments

Built with [Remotion](https://www.remotion.dev/) - Create videos programmatically in React
