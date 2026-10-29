# calories-web: calories.example.com (food tracker). Built ON THE VPS by Calories/infra/setup.mjs (step "web");
# Build: docker build -t calories-web . (secrets are filled into nginx.conf at build time).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/calories/
