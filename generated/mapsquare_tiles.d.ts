// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\mapsquare_tiles.jsonc'
// run `npm run filetypes` to rebuild

export type mapsquare_tiles = {
	tiles: {
		flags: number,
		shape: number | null,
		overlay: number | null,
		settings: number | null,
		underlay: number | null,
		height: number | null,
	}[],
	nonmembarea: Uint8Array,
	extra: {
		unk00?: {
			flags: number,
			unk01: number[] | null,
			unk02: number | null,
			unk04: number | null,
			unk08: number | null,
			unk10: [
				number,
				number,
				number,
			] | null,
			unk20: number[] | null,
			unk40: number | null,
			unk80: number | null,
		} | null
		unk01?: {
			byte2: number,
			short0: number,
			short1: number,
			short2: number,
			array5: number[][],
			short3: number,
			short4: number,
			extraflags: number,
			extra08: number,
			extra1f: number | null,
		}[] | null
		unk02?: number[] | null
		unk03?: [
			number,
			number,
		] | null
		unk80?: {
			environment: number,
			always00: Uint8Array,
		} | null
		unk81?: {
			flag: number,
			data: Uint8Array | null,
		}[] | null
		unk82?: true | null
	},
};
