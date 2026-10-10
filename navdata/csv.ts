import { parse } from 'csv-parse/sync';

export type Row = Record<string, string>;

/** Parse a NASR CSV file (header row + quoted values) into row objects. */
export function readCsv(text: string): Row[] {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Row[];
}
