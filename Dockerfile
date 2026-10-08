# Edi Life OS: PHP + Apache image. Pair with MySQL via docker-compose.yml.
FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
    && a2enmod rewrite headers

ENV APP_DIR=/var/www/lifeos
WORKDIR ${APP_DIR}

# Serve public_html as the web root and allow its .htaccess rules.
RUN sed -ri "s#/var/www/html#${APP_DIR}/public_html#g" /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory %s/public_html>\n    AllowOverride All\n    Require all granted\n</Directory>\nServerName localhost\n' "${APP_DIR}" > /etc/apache2/conf-available/lifeos.conf \
    && a2enconf lifeos

COPY --chown=www-data:www-data . ${APP_DIR}
# Configuration comes from environment variables; see docker/config.php.
COPY --chown=www-data:www-data docker/config.php ${APP_DIR}/config.php

# Attachments are stored next to the app in a path derived from its location;
# link that path to a volume so uploads survive container rebuilds.
RUN mkdir -p /data/attachments \
    && chown www-data:www-data /data/attachments \
    && ln -s /data/attachments "/var/www/.lifeos-files-$(php -r 'echo substr(hash("sha256", getenv("APP_DIR")), 0, 12);')"

VOLUME ["/data/attachments"]
EXPOSE 80
