FROM node:20-alpine

# Set timezone environment variable
ENV TZ=America/New_York

# Set working directory
WORKDIR /app

# Install system dependencies (including wget for healthcheck and tzdata)
RUN apk add --no-cache tzdata wget && \
    cp /usr/share/zoneinfo/America/New_York /etc/localtime && \
    echo "America/New_York" > /etc/timezone

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files (excluding node_modules, data, shared, etc. via .dockerignore)
COPY . .

# Create directories for runtime data (will be mounted as volumes)
RUN mkdir -p /app/data /app/shared && chown -R node:node /app

# Run as non-root user for security
USER node

# Expose port
EXPOSE 2452

# Start the application
CMD ["npm", "start"]
