export function sample<T>(data: T[]): T {
  return data[Math.floor(data.length * Math.random())];
}
