FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
