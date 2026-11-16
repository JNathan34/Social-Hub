FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /var/data && chown -R node:node /app /var/data
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/var/data
EXPOSE 3000
USER node
CMD ["npm", "start"]
