# Docker Deployment Guide

## Quick Start

### Using Docker Compose (Recommended)

1. **Set up environment variables** (optional):
   ```bash
   cp .env.example .env
   # Edit .env and set SESSION_SECRET to a random string
   ```

2. **Build and run**:
   ```bash
   docker-compose up -d
   ```

3. **Access the app**:
   - Open http://localhost:2452
   - Default credentials: `admin` / `admin123`
   - **IMPORTANT**: Change the admin password immediately!

4. **View logs**:
   ```bash
   docker-compose logs -f
   ```

5. **Stop the app**:
   ```bash
   docker-compose down
   ```

### Using Docker directly

1. **Build the image**:
   ```bash
   docker build -t whiteboard .
   ```

2. **Run the container**:
   ```bash
   docker run -d \
     --name whiteboard \
     -p 2452:2452 \
     -v whiteboard-data:/app/data \
     -v whiteboard-shared:/app/shared \
     -e SESSION_SECRET=your-secret-here \
     whiteboard
   ```

## Data Persistence

The app uses **named volumes** for data persistence:

- `whiteboard-data`: User notes and uploaded images
- `whiteboard-shared`: Shared notes metadata

These volumes persist across container restarts and rebuilds.

### Backing up data

```bash
# Backup data volume
docker run --rm -v whiteboard-data:/data -v $(pwd):/backup alpine tar czf /backup/whiteboard-data.tar.gz -C /data .

# Backup shared volume
docker run --rm -v whiteboard-shared:/data -v $(pwd):/backup alpine tar czf /backup/whiteboard-shared.tar.gz -C /data .
```

### Restoring data

```bash
# Restore data volume
docker run --rm -v whiteboard-data:/data -v $(pwd):/backup alpine tar xzf /backup/whiteboard-data.tar.gz -C /data

# Restore shared volume
docker run --rm -v whiteboard-shared:/data -v $(pwd):/backup alpine tar xzf /backup/whiteboard-shared.tar.gz -C /data
```

## Configuration

### Environment Variables

- `SESSION_SECRET`: Secret key for session encryption (required in production)
- `PORT`: Port to run the server on (default: 2452)
- `NODE_ENV`: Set to `production` for production deployments
- `TZ`: Timezone (default: America/New_York)

### Admin Panel Settings

After logging in as admin:
1. Go to Admin Panel
2. Navigate to Settings
3. Set "Public URL Base" to your domain (e.g., `https://yourdomain.com`)
   - This is used for generating share links

## Production Deployment

### Security Checklist

- [ ] Change default admin password
- [ ] Set a strong `SESSION_SECRET` environment variable
- [ ] Use HTTPS (reverse proxy with nginx/traefik)
- [ ] Set `PUBLIC_URL_BASE` to your actual domain
- [ ] Regularly backup data volumes
- [ ] Keep Docker images updated

### Example with Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:2452;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

### Container won't start
```bash
docker-compose logs whiteboard
```

### Reset everything (WARNING: deletes all data)
```bash
docker-compose down -v
docker-compose up -d
```

### Access container shell
```bash
docker exec -it whiteboard sh
```

### Check volume contents
```bash
docker run --rm -v whiteboard-data:/data alpine ls -la /data
```
