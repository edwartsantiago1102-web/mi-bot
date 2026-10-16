FROM node:20
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
EXPOSE 10000
CMD ["node", "index.js"]
