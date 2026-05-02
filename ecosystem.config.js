{
  "apps": [
    {
      "name": "telegram-shop-bot",
      "script": "index.js",
      "cwd": "./",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production",
        "BOT_MODE": "webhook"
      },
      "max_memory_restart": "512M",
      "error_file": "logs/error.log",
      "out_file": "logs/out.log",
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "merge_logs": true,
      "autorestart": true,
      "max_restarts": 20,
      "min_uptime": "30s",
      "listen_timeout": 5000,
      "kill_timeout": 5000,
      "watch": false,
      "ignore_watch": [
        "node_modules",
        "dist",
        "logs",
        ".git",
        ".vscode"
      ],
      "node_args": "--enable-source-maps"
    },
    {
      "name": "telegram-shop-api",
      "script": "server.js",
      "cwd": "./",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production",
        "API_PORT": "4000"
      },
      "max_memory_restart": "512M",
      "error_file": "logs/api-error.log",
      "out_file": "logs/api-out.log",
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "merge_logs": true,
      "autorestart": true,
      "max_restarts": 20,
      "min_uptime": "30s",
      "listen_timeout": 5000,
      "kill_timeout": 5000
    }
  ]
}
