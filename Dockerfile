FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

ENV PORT=8787
ENV CROSSSTAFF_DATA_DIR=/data
ENV CROSSSTAFF_ALLOW_COMMANDS=0

RUN mkdir -p /data

EXPOSE 8787

CMD ["node", "src/server.js"]
