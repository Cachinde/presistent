FROM mcr.microsoft.com/playwright:v1.47.0-focal

WORKDIR /app
ENV NODE_ENV=production \
    SIM_INTERVAL_SECONDS=180 \
    SIM_ENABLE_CHAT=true \
    SIM_CHAT_HOURS=9,15,21 \
    SIM_STATE_DIR=sim/state

COPY package*.json ./
RUN npm install --omit=dev

COPY sim ./sim
COPY browserSimulator.js ./.presistent-facade.js
COPY docker/docker-entry.sh ./
RUN chmod +x docker-entry.sh

CMD ["./docker-entry.sh"]
