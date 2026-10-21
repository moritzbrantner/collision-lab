import { Table, type TableColumnDef, type TableProps } from "@moritzbrantner/tables/table";

export type LabColumn<TRow> = TableColumnDef<TRow>;

const HEADER = "px-5 py-3 uppercase tracking-wide";

/** Collision Lab's dark result table: the shared semantic table with lab host styling. */
export function LabTable<TRow>({ className, columns, ...props }: TableProps<TRow>) {
  return (
    <Table
      className={className ? `lab-table ${className}` : "lab-table"}
      columns={columns.map((column) => ({
        ...column,
        headerClassName: column.headerClassName ?? HEADER,
      }))}
      {...props}
    />
  );
}

/** A plain column whose cell is a single monospaced value. */
export function monoColumn<TRow>(
  id: string,
  header: string,
  value: (row: TRow) => string,
  tone: "primary" | "muted" = "muted",
): LabColumn<TRow> {
  return {
    id,
    header,
    accessor: (row) => value(row),
    cellClassName: `px-5 py-4 font-mono ${tone === "primary" ? "text-zinc-200" : "text-zinc-400"}`,
  };
}
