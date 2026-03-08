export type Param = string | number | null;

export type DbRequest =
	| { type: 'init' }
	| { type: 'exec'; sql: string }
	| { type: 'query'; sql: string; params: Param[] }
	| { type: 'queryRaw'; sql: string }
	| { type: 'serialize' };

export type TableDump = {
	name: string;
	sql: string;
	columns: string[];
	rows: unknown[][];
};

export type DbResponse =
	| { type: 'ok' }
	| { type: 'rows'; rows: Record<string, unknown>[] }
	| { type: 'raw'; columns: string[]; rows: unknown[][] }
	| { type: 'dump'; tables: TableDump[] }
	| { type: 'error'; message: string };
