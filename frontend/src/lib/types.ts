export interface MetricDefinition {
	id: number;
	name: string;
	display_name: string;
	source: string;
	original_min: number;
	original_max: number;
	category: string | null;
	is_default: boolean;
}

export interface MetricsDataResponse {
	dates: string[];
	series: Record<string, (number | null)[]>;
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}
