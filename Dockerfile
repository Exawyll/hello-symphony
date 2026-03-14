FROM node:18-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node

EXPOSE 8080

CMD ["npm", "start"]
