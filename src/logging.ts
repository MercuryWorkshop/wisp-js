export const Levels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

export let log_level: typeof Levels[keyof typeof Levels] = Levels.INFO;

export function set_level(level: typeof Levels[keyof typeof Levels]) {
  log_level = level;
}

function get_timestamp() {
  let [date, time] = new Date().toJSON().split("T");
  date = date.replaceAll("-", "/");
  time = time.split(".")[0];
  return `[${date} - ${time}]`;
}

export function debug(...messages: unknown[]) {
  if (log_level > Levels.DEBUG) return;
  console.debug(get_timestamp() + " debug:", ...messages);
}

export function info(...messages: unknown[]) {
  if (log_level > Levels.INFO) return;
  console.info(get_timestamp() + " info:", ...messages);
}

export function log(...messages: unknown[]) {
  if (log_level > Levels.INFO) return;
  console.log(get_timestamp() + " log:", ...messages);
}

export function warn(...messages: unknown[]) {
  if (log_level > Levels.WARN) return;
  console.warn(get_timestamp() + " warn:", ...messages);
}

export function error(...messages: unknown[]) {
  if (log_level > Levels.ERROR) return;
  console.error(get_timestamp() + " error:", ...messages);
}

