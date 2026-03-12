# Use the official Node.js 18 image
FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy local code to the container image
COPY . .

# Start the service
CMD [ "npm", "start" ]
