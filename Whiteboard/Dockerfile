FROM node:20-bullseye

# Set timezone environment variable
ENV TZ=America/New_York

# Set working directory
WORKDIR /app

# Install system dependencies (including wget for healthcheck)
RUN apt-get update && \
    apt-get install -y tzdata wget && \
    ln -fs /usr/share/zoneinfo/America/New_York /etc/localtime && \
    echo "America/New_York" > /etc/timezone && \
    dpkg-reconfigure -f noninteractive tzdata && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files (excluding node_modules, data, shared, etc. via .dockerignore)
COPY . .

# Create directories for runtime data (will be mounted as volumes)
RUN mkdir -p /app/data /app/shared

# Expose port
EXPOSE 2452

# Start the application
CMD ["npm", "start"]
