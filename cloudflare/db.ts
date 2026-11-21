export async function all(db: any, sql: string, ...params: any[]): Promise<any[]> {
  const result = await db.prepare(sql).bind(...params).all();
  return (result.results ?? []) as any[];
}

export async function first(db: any, sql: string, ...params: any[]): Promise<any | null> {
  return (await db.prepare(sql).bind(...params).first()) ?? null;
}

export async function run(db: any, sql: string, ...params: any[]): Promise<void> {
  await db.prepare(sql).bind(...params).run();
}

export const parseJson = (value: any, fallback: any) => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
