import winston from "winston";
import path from "path";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(process.cwd(), "logs", "error.log"), level: "error" }),
    new winston.transports.File({ filename: path.join(process.cwd(), "logs", "combined.log") }),
  ],
});

export default logger;
