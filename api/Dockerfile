# The HanMarket price service and keeper bots, as one long-running container.
#
# The keeper must stay up: it pushes the testnet price feed, opens and closes perp sessions, liquidates
# underwater positions and settles expired options. A serverless function cannot do that — those jobs run
# on a cron inside this process (see src/index.ts).
#
# Works as-is on Railway, Render, Fly.io, Koyeb and any plain Docker host. Set the environment variables
# from .env.example; KEEPER_PRIVATE_KEY and PRICE_SIGNER_KEY belong in the host's secret store, never here.
FROM node:22-slim

WORKDIR /app

# dependencies first, so a code change does not reinstall them. --omit=dev would be wrong here even
# though this only serves an API: `npm start` runs ts-node directly (see CMD below), and ts-node and
# typescript live in devDependencies, not dependencies. Omitting dev deps builds fine, then crash-loops
# immediately with "ts-node: not found" — no build step ever proves the mistake.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# ts-node runs the TypeScript directly; the service is small enough that a build step buys nothing
CMD ["npm", "start"]
