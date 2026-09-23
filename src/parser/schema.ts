export interface RawRow {
  readonly __rowIndex: number;
  readonly Part_Number?: string | number;
  readonly Revision?: string | number;
  readonly Description?: string | number;
  readonly Status?: string | number;
  readonly UOM?: string | number;
  readonly Unit_Cost?: string | number;
  readonly Lead_Time_Days?: string | number;
  readonly Supplier?: string | number;
  readonly MPN?: string | number;
  readonly CAD_Path?: string | number;
  readonly Drawing_Path?: string | number;
  readonly Parent_Part_Number?: string | number;
  readonly Parent_Revision?: string | number;
  readonly Qty_Per_Parent?: string | number;
  readonly Substitutes?: string | number;
}
