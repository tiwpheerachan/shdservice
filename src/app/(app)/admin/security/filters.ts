import { qs, type Params } from '@/data/keys';

/** the security log's filter bar and its list URL (= its swr key) — pure: shared by the page and its server render */
export type Filters = {
  from: string;
  to: string;
  user: string;
  role: string;
  event: string;
  result: string;
  no: string;
  ip: string;
  q: string;
};
export const NO_FILTER: Filters = {
  from: '',
  to: '',
  user: '',
  role: '',
  event: '',
  result: '',
  no: '',
  ip: '',
  q: '',
};

export const PAGE_SIZE = 50;

export const listKey = (params: Params) => `/api/audit/security${qs(params)}`;
