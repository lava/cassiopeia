declare module '@garmin/fitsdk' {
	export class Stream {
		static fromArrayBuffer(arrayBuffer: ArrayBuffer): Stream;
		static fromByteArray(data: number[]): Stream;
		static fromBuffer(buffer: Buffer): Stream;
	}

	export class Decoder {
		constructor(stream: Stream);
		isFIT(): boolean;
		read(options?: {
			expandSubFields?: boolean;
			expandComponents?: boolean;
			applyScaleAndOffset?: boolean;
			convertTypesToStrings?: boolean;
			convertDateTimesToDates?: boolean;
			includeUnknownData?: boolean;
			mergeHeartRates?: boolean;
		}): {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			messages: Record<string, any[]>;
			errors: string[];
		};
	}

	export class Encoder {
		constructor();
	}

	export const Profile: unknown;
	export const Utils: unknown;
	export const CrcCalculator: unknown;
}
