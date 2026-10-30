import { qs, type Params } from '@/data/keys';

/** the audit log's filter bar and its list URL (= its swr key) — pure: shared by the page and its server render */
export type Filters = {
  from: string;
  to: string;
  user: string;
  role: string;
  module: string;
  entity: string;
  action: string;
  no: string;
  q: string;
};
export const NO_FILTER: Filters = {
  from: '',
  to: '',
  user: '',
  role: '',
  module: '',
  entity: '',
  action: '',
  no: '',
  q: '',
};

export const PAGE_SIZE = 50;

export const listKey = (params: Params) => `/api/audit${qs(params)}`;
