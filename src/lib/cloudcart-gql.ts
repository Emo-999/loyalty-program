import type { DbMerchant, CCProCondition } from '../types';

// GraphQL response shapes
export interface GqlCustomer {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  note: string | null;
  group_id: string | null;
  orders_count: number;
}

export interface GqlOrder {
  id: string;
  order_number: number;
  customer_id: string;
  customer_email: string;
  price_total: number;
  status: string;
  date_added: string;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Connection<T> {
  edges: Array<{ node: T }>;
  pageInfo: PageInfo;
}

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    path?: string[];
    extensions?: { code?: string; validationErrors?: Array<{ field: string; message: string }> };
  }>;
}

export class CloudCartGqlClient {
  constructor(
    private readonly patToken: string,
    private readonly gqlEndpoint: string,
  ) {}

  static forMerchant(merchant: DbMerchant): CloudCartGqlClient | null {
    if (!merchant.cloudcart_pat_token) return null;
    const base = merchant.cloudcart_base_url.replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '');
    return new CloudCartGqlClient(merchant.cloudcart_pat_token, `${base}/api/gql`);
  }

  private async query<T>(queryStr: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.gqlEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.patToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: queryStr, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`GraphQL HTTP ${res.status}: ${text}`);
    }

    const json = await res.json() as GqlResponse<T>;
    if (json.errors?.length) {
      const msg = json.errors.map(e => e.message).join('; ');
      throw new Error(`GraphQL error: ${msg}`);
    }

    return json.data!;
  }

  // ----------------------------------------------------------
  // Customers
  // ----------------------------------------------------------

  async listCustomers(
    first = 100,
    after?: string | null,
  ): Promise<{ customers: GqlCustomer[]; pageInfo: PageInfo }> {
    const data = await this.query<{ customers: Connection<GqlCustomer> }>(`
      query ListCustomers($first: Int!, $after: String) {
        customers(first: $first, after: $after) {
          edges {
            node {
              id email first_name last_name note group_id orders_count
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first, after });
    return {
      customers: data.customers.edges.map(e => e.node),
      pageInfo: data.customers.pageInfo,
    };
  }

  // ----------------------------------------------------------
  // Orders
  // ----------------------------------------------------------

  async listOrders(params: {
    first?: number;
    after?: string | null;
    status?: string;
    customerId?: string;
  }): Promise<{ orders: GqlOrder[]; pageInfo: PageInfo }> {
    const variables: Record<string, unknown> = {
      first: params.first ?? 100,
      after: params.after ?? null,
    };

    let statusFilter = '';
    let customerFilter = '';
    let extraVars = '';

    if (params.status) {
      statusFilter = ', status: { operator: is, value: [$status] }';
      extraVars += ', $status: String!';
      variables.status = params.status;
    }
    if (params.customerId) {
      customerFilter = ', customer_id: $customerId';
      extraVars += ', $customerId: ID!';
      variables.customerId = params.customerId;
    }

    const data = await this.query<{ orders: Connection<GqlOrder> }>(`
      query ListOrders($first: Int!, $after: String${extraVars}) {
        orders(first: $first, after: $after${statusFilter}${customerFilter}) {
          edges {
            node {
              id order_number customer_id customer_email
              price_total status date_added
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, variables);

    return {
      orders: data.orders.edges.map(e => e.node),
      pageInfo: data.orders.pageInfo,
    };
  }

  async fetchAllOrders(status?: string, customerId?: string): Promise<GqlOrder[]> {
    const allOrders: GqlOrder[] = [];
    let after: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const result = await this.listOrders({ first: 100, after, status, customerId });
      allOrders.push(...result.orders);
      hasNext = result.pageInfo.hasNextPage;
      after = result.pageInfo.endCursor;
    }
    return allOrders;
  }

  // ----------------------------------------------------------
  // Mutations: Customer
  // ----------------------------------------------------------

  async updateCustomer(
    id: string | number,
    input: { note?: string; group_id?: string | number },
  ): Promise<{ id: string }> {
    const data = await this.query<{ updateCustomer: { id: string } }>(`
      mutation UpdateCustomer($id: ID!, $input: UpdateCustomerInput!) {
        updateCustomer(id: $id, input: $input) { id }
      }
    `, { id: String(id), input });
    return data.updateCustomer;
  }

  // ----------------------------------------------------------
  // Mutations: Discount Code Pro
  // ----------------------------------------------------------

  async createCodeProCode(params: {
    discountId: number;
    code: string;
    name?: string;
    conditions: CCProCondition[];
    customerGroups?: number[];
  }): Promise<{ id: string }> {
    const input: Record<string, unknown> = {
      code: params.code,
      name: params.name,
      active: true,
      only_customer: true,
      maxused_user: 1,
      date_start: new Date().toISOString().slice(0, 10),
      conditions: params.conditions,
    };
    if (params.customerGroups?.length) {
      input.customer_groups = params.customerGroups;
    }

    const data = await this.query<{ createCodeProCode: { id: string; code: string } }>(`
      mutation CreateCodePro($discountId: ID!, $input: CodeProInput!) {
        createCodeProCode(discountId: $discountId, input: $input) { id code }
      }
    `, { discountId: String(params.discountId), input });
    return data.createCodeProCode;
  }

  async updateCodeProCode(
    discountId: number,
    codeId: number,
    input: { conditions?: CCProCondition[]; active?: boolean },
  ): Promise<{ id: string }> {
    const data = await this.query<{ updateCodeProCode: { id: string } }>(`
      mutation UpdateCodePro($discountId: ID!, $codeId: ID!, $input: CodeProInput!) {
        updateCodeProCode(discountId: $discountId, codeId: $codeId, input: $input) { id }
      }
    `, { discountId: String(discountId), codeId: String(codeId), input });
    return data.updateCodeProCode;
  }
}
