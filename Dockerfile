FROM node:18.17-alpine as builder

WORKDIR /usr/src/app

# install deps only
COPY package.json package-lock.json ./ 
RUN npm install

# build
ADD .babelrc tsconfig.json /usr/src/app/
ADD src /usr/src/app/src
RUN npm run build
RUN npm run config-schema

# runtime image
FROM node:18.17-alpine
WORKDIR /usr/app

ENV NODE_ENV=production
COPY package.json package-lock.json ./

RUN npm install
RUN apk add ffmpeg && \
	apk add --virtual dep_dev python3 gcc g++ make && \
	npm install @discordjs/opus && \
	apk del dep_dev

COPY --from=builder /usr/src/app/lib/ ./lib/
COPY --from=builder /usr/src/app/config_schema.json ./

ENTRYPOINT [ "node", "lib/main.js" ]
