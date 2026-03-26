import type {
  CCCustomer,
  CCOrder,
  CCCustomerGroup,
  CCDiscountCode,
  CCProCode,
  CCProCondition,
  CCDiscount,
  CCWebhook,
} from '../types';

interface JsonApiList<T> {
  data: T[];
  meta: { page: { total: number; 'last-page': number } };
}
interface JsonApiSingle<T> {
  data: T;
}

export class CloudCartClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-CloudCart-ApiKey': this.apiKey,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`CloudCart ${method} ${path} → ${res.status}: ${text}`);
    }

    // DELETE returns 204 no content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ----------------------------------------------------------
  // Customers
  // ----------------------------------------------------------
  async getCustomer(id: number): Promise<CCCustomer> {
    const r = await this.req<JsonApiSingle<CCCustomer>>('GET', `/customers/${id}`);
    return r.data;
  }

  async updateCustomer(
    id: number,
    attrs: Partial<CCCustomer['attributes']>,
  ): Promise<CCCustomer> {
    const r = await this.req<JsonApiSingle<CCCustomer>>('PATCH', `/customers/${id}`, {
      data: { type: 'customers', id: String(id), attributes: attrs },
    });
    return r.data;
  }

  async listCustomers(page = 1, size = 50): Promise<JsonApiList<CCCustomer>> {
    return this.req<JsonApiList<CCCustomer>>(
      'GET',
      `/customers?page[number]=${page}&page[size]=${size}`,
    );
  }

  // ----------------------------------------------------------
  // Customer groups
  // ----------------------------------------------------------
  async listCustomerGroups(): Promise<CCCustomerGroup[]> {
    const r = await this.req<JsonApiList<CCCustomerGroup>>('GET', '/customer-groups');
    return r.data;
  }

  async createCustomerGroup(name: string): Promise<CCCustomerGroup> {
    const r = await this.req<JsonApiSingle<CCCustomerGroup>>(
      'POST',
      '/customer-groups',
      { data: { type: 'customer-groups', attributes: { name } } },
    );
    return r.data;
  }

  // ----------------------------------------------------------
  // Discount codes
  // ----------------------------------------------------------
  async getDiscountCode(id: number): Promise<CCDiscountCode> {
    const r = await this.req<JsonApiSingle<CCDiscountCode>>(
      'GET',
      `/discount-codes/${id}`,
    );
    return r.data;
  }

  async listDiscountCodes(): Promise<CCDiscountCode[]> {
    const r = await this.req<JsonApiList<CCDiscountCode>>(
      'GET',
      '/discount-codes',
    );
    return r.data;
  }

  /** Create personal loyalty promo code. Code must be alphanumeric. */
  async createDiscountCode(code: string, valueEur: number): Promise<CCDiscountCode> {
    const r = await this.req<JsonApiSingle<CCDiscountCode>>(
      'POST',
      '/discount-codes',
      {
        data: {
          type: 'discount-codes',
          attributes: { code, value: valueEur, active: 1 },
        },
      },
    );
    return r.data;
  }

  /** Update the EUR value on an existing discount code. */
  async updateDiscountCode(id: number, valueEur: number): Promise<CCDiscountCode> {
    const r = await this.req<JsonApiSingle<CCDiscountCode>>(
      'PATCH',
      `/discount-codes/${id}`,
      {
        data: {
          type: 'discount-codes',
          id: String(id),
          attributes: { value: valueEur },
        },
      },
    );
    return r.data;
  }

  async deleteDiscountCode(id: number): Promise<void> {
    await this.req<void>('DELETE', `/discount-codes/${id}`);
  }

  // ----------------------------------------------------------
  // Webhooks
  // ----------------------------------------------------------
  async listWebhooks(): Promise<CCWebhook[]> {
    const r = await this.req<JsonApiList<CCWebhook>>('GET', '/webhooks');
    return r.data;
  }

  async createWebhook(
    url: string,
    event: string,
    secretHeader?: string,
  ): Promise<CCWebhook> {
    const requestHeaders = secretHeader
      ? [{ name: 'X-Loyalty-Secret', value: secretHeader }]
      : [];
    const r = await this.req<JsonApiSingle<CCWebhook>>('POST', '/webhooks', {
      data: {
        type: 'webhooks',
        attributes: { url, event, active: 1, request_headers: requestHeaders },
      },
    });
    return r.data;
  }

  async deleteWebhook(id: number): Promise<void> {
    await this.req<void>('DELETE', `/webhooks/${id}`);
  }

  // ----------------------------------------------------------
  // Orders
  // ----------------------------------------------------------
  async getOrder(id: number): Promise<CCOrder> {
    const r = await this.req<JsonApiSingle<CCOrder>>('GET', `/orders/${id}`);
    return r.data;
  }

  async listOrders(
    page = 1,
    size = 50,
    filterStatus?: string,
  ): Promise<JsonApiList<CCOrder>> {
    let path = `/orders?page[number]=${page}&page[size]=${size}`;
    if (filterStatus) path += `&filter[status]=${filterStatus}`;
    return this.req<JsonApiList<CCOrder>>('GET', path);
  }

  // ----------------------------------------------------------
  // Discount containers (code-pro type)
  // ----------------------------------------------------------

  /** Create a discount container of type code-pro — one per store, holds all loyalty codes. */
  async createDiscountContainer(name: string): Promise<CCDiscount> {
    const r = await this.req<JsonApiSingle<CCDiscount>>('POST', '/discounts', {
      data: {
        type: 'discounts',
        attributes: {
          name,
          discount_type: 'code-pro',
          date_start: new Date().toISOString().slice(0, 10),
          active: 'yes',
        },
      },
    });
    return r.data;
  }

  async listDiscounts(): Promise<CCDiscount[]> {
    const r = await this.req<JsonApiList<CCDiscount>>('GET', '/discounts');
    return r.data;
  }

  // ----------------------------------------------------------
  // Discount Codes Pro (individual loyalty codes)
  // ----------------------------------------------------------

  /** Fetch a single pro code by its CloudCart ID. */
  async getProCode(id: number): Promise<CCProCode> {
    const r = await this.req<JsonApiSingle<CCProCode>>(
      'GET',
      `/discount-codes-pro/${id}`,
    );
    return r.data;
  }

  /** List pro codes for a container, optionally filter by customer code. */
  async listProCodes(containerId: number, page = 1, size = 50): Promise<JsonApiList<CCProCode>> {
    return this.req<JsonApiList<CCProCode>>(
      'GET',
      `/discount-codes-pro?filter[discount_id]=${containerId}&page[number]=${page}&page[size]=${size}`,
    );
  }

  /**
   * Create a personal loyalty pro code for a customer.
   * - flat discount on all products = points / rate (in cents)
   * - only_customer: 1 → must be logged in (prevents code sharing)
   * - maxused_user: 1 → single-use per customer (auto-detects redemption via uses counter)
   */
  async createProCode(params: {
    containerId: number;
    code: string;
    name: string;
    valueCents: number;       // flat discount in cents (500 = €5)
    conditions?: CCProCondition[];
    customerGroupIds?: number[];
  }): Promise<CCProCode> {
    const conditions: CCProCondition[] = params.conditions ?? [
      { type: 'flat', setting: 'all', value: params.valueCents },
    ];

    const r = await this.req<JsonApiSingle<CCProCode>>(
      'POST',
      '/discount-codes-pro',
      {
        data: {
          type: 'discount-codes-pro',
          attributes: {
            discount_id: params.containerId,
            code: params.code,
            name: params.name,
            active: 1,
            only_customer: 1,
            maxused_user: 1,
            date_start: new Date().toISOString().slice(0, 10),
            conditions,
            ...(params.customerGroupIds?.length
              ? { customer_groups: params.customerGroupIds }
              : {}),
          },
        },
      },
    );
    return r.data;
  }

  /**
   * Update the discount value on an existing pro code.
   * Replaces the full conditions array with a new flat-all condition.
   */
  async updateProCodeValue(id: number, valueCents: number, conditions?: CCProCondition[]): Promise<CCProCode> {
    const newConditions: CCProCondition[] = conditions ?? [
      { type: 'flat', setting: 'all', value: valueCents },
    ];
    const r = await this.req<JsonApiSingle<CCProCode>>(
      'PATCH',
      `/discount-codes-pro/${id}`,
      {
        data: {
          type: 'discount-codes-pro',
          id: String(id),
          attributes: { conditions: newConditions, active: 1 },
        },
      },
    );
    return r.data;
  }

  async deleteProCode(id: number): Promise<void> {
    await this.req<void>('DELETE', `/discount-codes-pro/${id}`);
  }
}
