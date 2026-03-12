# hello-symphony

A minimal Hello World Node.js HTTP server.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later

## Getting Started

### Install dependencies

This project has no runtime dependencies, so no installation step is required.

### Run the server

```bash
npm start
```

The server will start and listen on **http://localhost:3000**.

### Try it out

```bash
curl http://localhost:3000/
```

Expected response:

```json
{ "message": "Hello, World!" }
```

## Project Structure

```
.
├── src/
│   └── index.js   # HTTP server entry point
├── package.json
└── README.md
```
