# Node 22.18+ runs TypeScript directly by stripping the type annotations, so
# there is no build stage here and no compiled output. What you see in src/ is
# what runs.
FROM node:24-alpine

WORKDIR /app

# package.json is needed at runtime for one reason: "type": "module", which is
# what tells Node to treat the .ts files as ES modules. There are no runtime
# dependencies, so there is no npm install step.
COPY package.json ./

COPY src ./src
COPY data ./data

CMD ["node", "src/index.ts"]
