/** every field is AND-ed on the server; same params feed the Excel export. Pure: shared with the server render. */
export type CustomerFilter = {
  code: string;
  name: string;
  phone: string;
  email: string;
  taxId: string;
  type: string;
  province: string;
  status: '' | 'Active' | 'Inactive';
};
export const NO_FILTER: CustomerFilter = {
  code: '',
  name: '',
  phone: '',
  email: '',
  taxId: '',
  type: '',
  province: '',
  status: '',
};
