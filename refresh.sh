### Run this after docker compose down to re-build the container and redeploy it easily.

sudo docker rmi whiteboard-whiteboard:latest --force
sudo docker build .
sudo docker compose up -d
