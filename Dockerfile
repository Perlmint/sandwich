FROM node:15.12-alpine

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
FROM node:15.12-alpine
WORKDIR /usr/app

ENV NODE_ENV=production
COPY package.json package-lock.json ./

RUN npm install

COPY --from=0 /usr/src/app/lib/ ./lib/
COPY --from=0 /usr/src/app/config_schema.json ./

ENTRYPOINT [ "node", "lib/main.js" ]
