import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

const logger = winston.createLogger({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        // Rotation native winston (aucune dépendance) : 5 Mo par fichier, 5
        // fichiers conservés (les anciens sont écrasés), le plus récent garde
        // le nom de base (tailable). Les journaux ne portent aucune donnée
        // personnelle (pas d'e-mail, pas d'identifiant de compte local) ;
        // la rotation borne en plus leur durée de vie.
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        }),
        new winston.transports.File({
            filename: "logs/combined.log",
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        })
    ],
    exitOnError: false,
});

export default logger; 