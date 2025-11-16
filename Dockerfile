FROM apify/actor-node-playwright-chrome:20

# Copy all files
COPY . ./

# Install dependencies
RUN npm install --include=optional

# Run the actor
CMD npm start
