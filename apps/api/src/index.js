"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const elysia_1 = require("elysia");
const cors_1 = require("@elysiajs/cors");
const app = new elysia_1.Elysia()
    .use((0, cors_1.cors)())
    .get('/', () => ({ message: 'API is running!' }))
    .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString()
}));
const port = process.env.PORT || 3001;
console.log(`API server running on port ${port}`);
app.listen(port);
exports.default = app;
