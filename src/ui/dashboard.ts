// ============================================================
// Login page — served at /admin
// ============================================================
export const loginHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loyalty Program — Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>[x-cloak] { display: none !important; }</style>
</head>
<body class="bg-gradient-to-br from-violet-50 to-indigo-100 min-h-screen flex items-center justify-center">

<div x-data="loginForm()" x-cloak class="w-full max-w-sm">
  <div class="bg-white rounded-2xl shadow-xl p-8">
    <div class="text-center mb-6">
      <span class="text-4xl">🎯</span>
      <h1 class="text-xl font-bold mt-2">Loyalty Program</h1>
      <p class="text-sm text-gray-400 mt-1">Sign in to your merchant dashboard</p>
    </div>

    <div x-show="error" class="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg mb-4" x-text="error"></div>

    <form @submit.prevent="login()" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">Store Slug</label>
        <input x-model="slug" type="text" required placeholder="e.g. smokezone"
          class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        <p class="text-xs text-gray-400 mt-1">Your unique store identifier</p>
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Password</label>
        <input x-model="password" type="password" required
          class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>
      <button type="submit" :disabled="loading"
        class="w-full bg-violet-600 text-white py-2.5 rounded-lg hover:bg-violet-700 text-sm font-medium disabled:opacity-50">
        <span x-show="!loading">Sign In</span>
        <span x-show="loading">Signing in…</span>
      </button>
    </form>
  </div>
</div>

<script>
function loginForm() {
  return {
    slug: '',
    password: '',
    error: '',
    loading: false,
    login() {
      this.error = '';
      this.loading = true;
      const s = this.slug.trim().toLowerCase();
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: s, password: this.password }),
      })
        .then(r => r.json())
        .then(data => {
          this.loading = false;
          if (data.ok) {
            localStorage.setItem('loyalty_token', data.token);
            localStorage.setItem('loyalty_slug', s);
            window.location.href = '/admin/' + s;
          } else {
            this.error = data.error || 'Login failed';
          }
        })
        .catch(() => { this.loading = false; this.error = 'Network error'; });
    },
  };
}
</script>
</body>
</html>`;

// ============================================================
// Dashboard — served at /admin/:slug
// ============================================================
export const dashboardHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loyalty Program — Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    .tab-active { border-bottom: 2px solid #7c3aed; color: #6d28d9; font-weight: 600; }
    @keyframes row-highlight {
      0%   { background-color: #f5f3ff; }
      30%  { background-color: #ede9fe; }
      100% { background-color: transparent; }
    }
    @keyframes points-pop {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.3); color: #16a34a; }
      100% { transform: scale(1); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .row-synced { animation: row-highlight 2s ease-out; }
    .points-updated { animation: points-pop 0.6s ease-out; }
    .sync-spinner { animation: spin 0.8s linear infinite; display: inline-block; }
    @keyframes badge-in {
      0%   { transform: scale(0); opacity: 0; }
      60%  { transform: scale(1.2); }
      100% { transform: scale(1); opacity: 1; }
    }
    .badge-pop { animation: badge-in 0.4s ease-out; }
  </style>
</head>
<body class="bg-gray-50 text-gray-800 font-sans">

<div x-data="app()" x-init="init()" x-cloak>

  <!-- Header -->
  <header class="bg-white border-b shadow-sm sticky top-0 z-10">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🎯</span>
        <div>
          <h1 class="font-bold text-lg leading-tight" x-text="settings.store_name + ' — Loyalty'">Loyalty Admin</h1>
          <p class="text-xs text-gray-400" x-text="'Merchant: ' + slug">CRM Dashboard</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="runSetup()" class="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">
          ⚙️ Run Setup
        </button>
        <button @click="syncExisting()" :disabled="_bulkSyncing"
          class="text-xs bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-wait">
          <span x-show="!_bulkSyncing">🔄 Sync Customers</span>
          <span x-show="_bulkSyncing" class="sync-spinner">↻</span>
          <span x-show="_bulkSyncing"> Syncing…</span>
        </button>
        <button @click="logout()" class="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">
          Logout
        </button>
      </div>
    </div>
    <!-- Tabs -->
    <div class="max-w-7xl mx-auto px-4 flex gap-6 text-sm text-gray-500 border-t overflow-x-auto">
      <template x-for="tab in tabs" :key="tab.id">
        <button
          @click="activeTab = tab.id"
          :class="activeTab === tab.id ? 'tab-active' : 'hover:text-gray-700'"
          class="py-2 px-1 transition-colors whitespace-nowrap"
          x-text="tab.label">
        </button>
      </template>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 py-6">

    <!-- Toast -->
    <div x-show="toast.msg" x-transition
      :class="toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'"
      class="fixed top-4 right-4 z-50 text-white px-4 py-2 rounded-lg shadow text-sm"
      x-text="toast.msg">
    </div>

    <!-- ===== OVERVIEW ===== -->
    <div x-show="activeTab === 'overview'">
      <h2 class="text-lg font-semibold mb-4">Overview</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl p-4 shadow-sm border">
          <p class="text-xs text-gray-400 mb-1">Total Customers</p>
          <p class="text-2xl font-bold text-violet-600" x-text="stats.total_customers ?? '—'"></p>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border">
          <p class="text-xs text-gray-400 mb-1">Points Outstanding</p>
          <p class="text-2xl font-bold text-amber-500" x-text="(stats.total_points_outstanding ?? 0).toLocaleString()"></p>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border">
          <p class="text-xs text-gray-400 mb-1">Total Transactions</p>
          <p class="text-2xl font-bold text-blue-500" x-text="stats.total_transactions ?? '—'"></p>
        </div>
        <div class="bg-white rounded-xl p-4 shadow-sm border">
          <p class="text-xs text-gray-400 mb-1">Points → € Rate</p>
          <p class="text-2xl font-bold text-green-500">
            <span x-text="settings.points_to_eur_rate"></span> pts = €1
          </p>
        </div>
      </div>
      <div class="bg-white rounded-xl shadow-sm border p-4 mb-6">
        <h3 class="font-semibold mb-3 text-sm text-gray-600">Tier Distribution</h3>
        <div class="flex flex-wrap gap-3">
          <template x-for="(count, tierName) in stats.tier_distribution" :key="tierName">
            <div class="bg-gray-50 rounded-lg px-3 py-2 text-center min-w-[80px]">
              <p class="text-xs text-gray-400" x-text="tierName"></p>
              <p class="text-lg font-bold text-violet-600" x-text="count"></p>
            </div>
          </template>
        </div>
      </div>
      <div class="bg-white rounded-xl shadow-sm border p-4">
        <h3 class="font-semibold mb-3 text-sm text-gray-600">Recent Activity</h3>
        <div class="space-y-2">
          <template x-for="tx in stats.recent_transactions" :key="tx.id">
            <div class="flex items-center justify-between text-sm py-1 border-b last:border-0">
              <div>
                <span class="font-medium" x-text="tx.loyalty_customers?.email ?? '—'"></span>
                <span class="text-gray-400 ml-2" x-text="tx.description"></span>
              </div>
              <div :class="tx.points > 0 ? 'text-green-600' : 'text-red-500'" class="font-semibold">
                <span x-text="(tx.points > 0 ? '+' : '') + tx.points.toLocaleString()"></span>
                <span class="text-gray-400 ml-1">pts</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ===== CUSTOMERS ===== -->
    <div x-show="activeTab === 'customers'">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Customers</h2>
        <input x-model="customerSearch" @input.debounce.400ms="loadCustomers(1)"
          type="search" placeholder="Search email / name…"
          class="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>
      <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th class="px-4 py-3 text-left">Customer</th>
              <th class="px-4 py-3 text-right">Points</th>
              <th class="px-4 py-3 text-right">Lifetime</th>
              <th class="px-4 py-3 text-center">Tier</th>
              <th class="px-4 py-3 text-center">Promo Code</th>
              <th class="px-4 py-3 text-center">€ Value</th>
              <th class="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="cust in customers.data" :key="cust.id">
              <tr class="border-t hover:bg-gray-50 transition-colors" :id="'cust-row-' + cust.id">
                <td class="px-4 py-3">
                  <p class="font-medium" x-text="(cust.first_name ?? '') + ' ' + (cust.last_name ?? '')"></p>
                  <p class="text-xs text-gray-400" x-text="cust.email"></p>
                </td>
                <td class="px-4 py-3 text-right">
                  <span class="font-semibold text-violet-600 inline-block" :id="'pts-' + cust.id"
                    x-text="(cust.points_balance ?? 0).toLocaleString()"></span>
                  <div x-show="cust._pointsDelta > 0" x-transition class="text-xs text-green-600 font-medium mt-0.5"
                    x-text="'+' + (cust._pointsDelta ?? 0).toLocaleString() + ' pts'"></div>
                </td>
                <td class="px-4 py-3 text-right text-xs text-gray-400"
                  x-text="(cust.lifetime_points ?? 0).toLocaleString()"></td>
                <td class="px-4 py-3 text-center">
                  <span x-show="cust.tiers"
                    class="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium"
                    :class="cust._tierJustChanged ? 'badge-pop' : ''"
                    x-text="cust.tiers?.name"></span>
                  <span x-show="!cust.tiers" class="text-gray-300 text-xs">—</span>
                </td>
                <td class="px-4 py-3 text-center text-xs font-mono text-gray-600" x-text="cust.promo_code ?? '—'"></td>
                <td class="px-4 py-3 text-center text-sm font-semibold text-green-600"
                  x-text="'€' + Math.floor((cust.points_balance ?? 0) / settings.points_to_eur_rate)">
                </td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                  <button @click="openAdjust(cust)"
                    class="text-xs bg-violet-50 text-violet-700 px-2 py-1 rounded hover:bg-violet-100 mr-1">Adjust</button>
                  <button @click="openVouchers(cust)"
                    class="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 mr-1">Vouchers</button>
                  <button @click="syncCustomer(cust)" :disabled="cust._syncing"
                    class="text-xs px-2 py-1 rounded transition-all"
                    :class="cust._syncing
                      ? 'bg-violet-100 text-violet-500 cursor-wait'
                      : cust._syncDone
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'">
                    <span x-show="cust._syncing" class="sync-spinner">↻</span>
                    <span x-show="cust._syncing"> Syncing…</span>
                    <span x-show="!cust._syncing && cust._syncDone">✓ Synced</span>
                    <span x-show="!cust._syncing && !cust._syncDone">Sync</span>
                  </button>
                </td>
              </tr>
            </template>
            <tr x-show="!customers.data?.length">
              <td colspan="7" class="px-4 py-8 text-center text-gray-400 text-sm">No customers found</td>
            </tr>
          </tbody>
        </table>
        <div class="px-4 py-3 bg-gray-50 border-t flex items-center justify-between text-xs text-gray-500">
          <span>Total: <strong x-text="customers.total ?? 0"></strong></span>
          <div class="flex gap-2">
            <button @click="loadCustomers(customers.page - 1)" :disabled="customers.page <= 1"
              class="px-2 py-1 rounded border hover:bg-white disabled:opacity-40">← Prev</button>
            <span class="px-2 py-1" x-text="'Page ' + (customers.page ?? 1)"></span>
            <button @click="loadCustomers(customers.page + 1)"
              :disabled="(customers.page * customers.size) >= customers.total"
              class="px-2 py-1 rounded border hover:bg-white disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TRANSACTIONS ===== -->
    <div x-show="activeTab === 'transactions'">
      <h2 class="text-lg font-semibold mb-4">Transaction Log</h2>
      <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th class="px-4 py-3 text-left">Date</th>
              <th class="px-4 py-3 text-left">Customer</th>
              <th class="px-4 py-3 text-left">Type</th>
              <th class="px-4 py-3 text-right">Points</th>
              <th class="px-4 py-3 text-left">Description</th>
              <th class="px-4 py-3 text-right">Order Value</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="tx in transactions.data" :key="tx.id">
              <tr class="border-t hover:bg-gray-50">
                <td class="px-4 py-2 text-gray-400 text-xs" x-text="new Date(tx.created_at).toLocaleDateString()"></td>
                <td class="px-4 py-2">
                  <span x-text="tx.loyalty_customers?.email ?? '—'" class="text-xs"></span>
                </td>
                <td class="px-4 py-2">
                  <span :class="{
                    'bg-green-100 text-green-700': tx.type === 'earn',
                    'bg-blue-100 text-blue-700': tx.type === 'redeem',
                    'bg-amber-100 text-amber-700': tx.type === 'adjust',
                    'bg-red-100 text-red-700': tx.type === 'expire',
                  }" class="text-xs px-2 py-0.5 rounded-full font-medium" x-text="tx.type"></span>
                </td>
                <td class="px-4 py-2 text-right font-semibold"
                  :class="tx.points >= 0 ? 'text-green-600' : 'text-red-500'"
                  x-text="(tx.points > 0 ? '+' : '') + tx.points.toLocaleString()"></td>
                <td class="px-4 py-2 text-gray-500 text-xs" x-text="tx.description"></td>
                <td class="px-4 py-2 text-right text-xs text-gray-400"
                  x-text="tx.order_value_cents ? '€' + (tx.order_value_cents/100).toFixed(2) : '—'"></td>
              </tr>
            </template>
          </tbody>
        </table>
        <div class="px-4 py-3 bg-gray-50 border-t flex items-center justify-between text-xs text-gray-500">
          <span>Total: <strong x-text="transactions.total ?? 0"></strong></span>
          <div class="flex gap-2">
            <button @click="loadTransactions(transactions.page - 1)" :disabled="transactions.page <= 1"
              class="px-2 py-1 rounded border hover:bg-white disabled:opacity-40">← Prev</button>
            <span x-text="'Page ' + (transactions.page ?? 1)" class="px-2 py-1"></span>
            <button @click="loadTransactions(transactions.page + 1)"
              :disabled="(transactions.page * transactions.size) >= transactions.total"
              class="px-2 py-1 rounded border hover:bg-white disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TIERS ===== -->
    <div x-show="activeTab === 'tiers'">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Loyalty Tiers</h2>
        <button @click="openTierForm(null)" class="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">+ Add Tier</button>
      </div>
      <div class="grid gap-3">
        <template x-for="tier in tiers" :key="tier.id">
          <div class="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between">
            <div>
              <p class="font-semibold" x-text="tier.name"></p>
              <p class="text-xs text-gray-400">
                Starts at <strong x-text="tier.min_points.toLocaleString()"></strong> points
                <span x-show="tier.cloudcart_group_id"> · CC group #<span x-text="tier.cloudcart_group_id"></span></span>
              </p>
            </div>
            <div class="flex gap-2">
              <button @click="openTierForm(tier)" class="text-xs bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Edit</button>
              <button @click="deleteTier(tier.id)" class="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded hover:bg-red-100">Delete</button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ===== REWARDS ===== -->
    <div x-show="activeTab === 'rewards'">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Reward Types</h2>
        <button @click="openRewardForm(null)" class="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">+ Add Reward</button>
      </div>
      <p class="text-sm text-gray-500 mb-4">Configure the types of discounts customers can earn. These map to CloudCart discount-codes-pro conditions.</p>
      <div class="grid gap-3">
        <template x-for="rw in rewards" :key="rw.id">
          <div class="bg-white rounded-xl shadow-sm border p-4">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-semibold" x-text="rw.name"></p>
                  <span :class="rw.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                    class="text-xs px-2 py-0.5 rounded-full" x-text="rw.active ? 'Active' : 'Inactive'"></span>
                  <span x-show="rw.auto_apply" class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Auto</span>
                </div>
                <p class="text-xs text-gray-400" x-text="rw.description"></p>
                <p class="text-xs text-gray-500 mt-1">
                  <span class="font-medium" x-text="rw.discount_method.toUpperCase()"></span>
                  · Target: <span x-text="rw.discount_target"></span>
                  <span x-show="rw.discount_value"> · Value: <span x-text="rw.discount_method === 'percent' ? (rw.discount_value/100).toFixed(0)+'%' : '€'+(rw.discount_value/100).toFixed(2)"></span></span>
                  <span x-show="rw.min_points_cost"> · Costs: <span x-text="rw.min_points_cost.toLocaleString()"></span> pts</span>
                </p>
              </div>
              <div class="flex gap-2 ml-4 shrink-0">
                <button @click="openRewardForm(rw)" class="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200">Edit</button>
                <button @click="deleteReward(rw.id)" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100">Delete</button>
              </div>
            </div>
          </div>
        </template>
        <p x-show="!rewards.length" class="text-center text-gray-400 text-sm py-8">No reward types configured</p>
      </div>

      <div class="mt-8">
        <h3 class="text-md font-semibold mb-3">Issued Vouchers</h3>
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th class="px-4 py-3 text-left">Customer</th>
                <th class="px-4 py-3 text-left">Reward</th>
                <th class="px-4 py-3 text-center">Voucher Code</th>
                <th class="px-4 py-3 text-center">Status</th>
                <th class="px-4 py-3 text-left">Issued</th>
              </tr>
            </thead>
            <tbody>
              <template x-for="iv in issuedVouchers" :key="iv.id">
                <tr class="border-t hover:bg-gray-50">
                  <td class="px-4 py-2 text-xs" x-text="iv.loyalty_customers?.email ?? '—'"></td>
                  <td class="px-4 py-2 text-xs font-medium" x-text="iv.reward_types?.name ?? '—'"></td>
                  <td class="px-4 py-2 text-center text-xs font-mono text-violet-600" x-text="iv.voucher_code"></td>
                  <td class="px-4 py-2 text-center">
                    <span :class="{
                      'bg-green-100 text-green-700': iv.status === 'active',
                      'bg-blue-100 text-blue-700': iv.status === 'redeemed',
                      'bg-gray-100 text-gray-500': iv.status === 'expired',
                    }" class="text-xs px-2 py-0.5 rounded-full font-medium" x-text="iv.status"></span>
                  </td>
                  <td class="px-4 py-2 text-xs text-gray-400" x-text="new Date(iv.created_at).toLocaleDateString()"></td>
                </tr>
              </template>
              <tr x-show="!issuedVouchers?.length">
                <td colspan="5" class="px-4 py-6 text-center text-gray-400 text-sm">No vouchers issued yet. Vouchers are auto-assigned when customers reach the required points.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ===== RULES ===== -->
    <div x-show="activeTab === 'rules'">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Bonus Rules</h2>
        <button @click="openRuleForm(null)" class="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">+ Add Rule</button>
      </div>
      <div class="grid gap-3">
        <template x-for="rule in rules" :key="rule.id">
          <div class="bg-white rounded-xl shadow-sm border p-4">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-semibold" x-text="rule.name"></p>
                  <span :class="rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'"
                    class="text-xs px-2 py-0.5 rounded-full" x-text="rule.active ? 'Active' : 'Inactive'"></span>
                </div>
                <p class="text-xs text-gray-400" x-text="rule.description"></p>
                <p class="text-xs text-gray-500 mt-1">
                  Type: <span x-text="rule.type" class="font-medium"></span>
                  <span x-show="rule.extra_points"> · +<span x-text="rule.extra_points"></span> pts</span>
                  <span x-show="rule.multiplier && rule.multiplier !== 1"> · ×<span x-text="rule.multiplier"></span></span>
                </p>
              </div>
              <div class="flex gap-2 ml-4 shrink-0">
                <button @click="toggleRule(rule)" class="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200"
                  x-text="rule.active ? 'Disable' : 'Enable'"></button>
                <button @click="openRuleForm(rule)" class="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200">Edit</button>
                <button @click="deleteRule(rule.id)" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100">Del</button>
              </div>
            </div>
          </div>
        </template>
        <p x-show="!rules.length" class="text-center text-gray-400 text-sm py-8">No bonus rules yet</p>
      </div>
    </div>

    <!-- ===== SETTINGS ===== -->
    <div x-show="activeTab === 'settings'">
      <h2 class="text-lg font-semibold mb-4">Settings</h2>
      <div class="bg-white rounded-xl shadow-sm border p-6 max-w-lg">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Store Name</label>
            <input x-model="settings.store_name" type="text"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Points per €1 spent</label>
            <input x-model.number="settings.points_per_eur" type="number" min="1" step="1"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Points needed for €1 discount</label>
            <input x-model.number="settings.points_to_eur_rate" type="number" min="1" step="1"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Minimum order (€) to earn points</label>
            <input x-model.number="settings.min_order_eur" type="number" min="0" step="1"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Trigger on order status</label>
            <select x-model="settings.trigger_status"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
              <option value="paid">paid</option>
              <option value="completed">completed</option>
              <option value="fulfilled">fulfilled</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Promo code prefix</label>
            <input x-model="settings.promo_code_prefix" type="text" maxlength="8"
              class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
            <p class="text-xs text-gray-400 mt-1">Customer #3 → <span x-text="settings.promo_code_prefix + '3'" class="font-mono"></span></p>
          </div>
          <button @click="saveSettings()" class="w-full bg-violet-600 text-white py-2 rounded-lg hover:bg-violet-700 text-sm font-medium">
            Save Settings
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border p-6 max-w-lg mt-6">
        <h3 class="font-semibold mb-3 flex items-center gap-2">
          <span class="text-violet-600">⚡</span> GraphQL API (Optional)
        </h3>
        <p class="text-xs text-gray-500 mb-3">Connect a CloudCart Personal Access Token to use the faster GraphQL API for syncing customers and orders. Generate one from your CloudCart admin → Settings → API Keys.</p>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">PAT Token</label>
            <input x-model="patToken" type="password" placeholder="cc_pat_..."
              class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-2 py-0.5 rounded-full" :class="patToken ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'" x-text="patToken ? '✓ Connected — using GraphQL' : 'Not set — using REST API'"></span>
          </div>
          <button @click="savePatToken()" class="w-full bg-violet-600 text-white py-2 rounded-lg hover:bg-violet-700 text-sm font-medium">
            Save PAT Token
          </button>
        </div>
      </div>
    </div>

  </main>

  <!-- ===== MODAL: Adjust Points ===== -->
  <div x-show="modal.open" x-transition class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" @click.stop>
      <h3 class="font-semibold text-lg mb-1">Adjust Points</h3>
      <p class="text-sm text-gray-400 mb-4" x-text="modal.customer?.email"></p>
      <div class="mb-3">
        <label class="text-xs font-medium text-gray-600 block mb-1">Current balance</label>
        <p class="text-2xl font-bold text-violet-600" x-text="(modal.customer?.points_balance ?? 0).toLocaleString() + ' pts'"></p>
      </div>
      <div class="mb-3">
        <label class="text-xs font-medium text-gray-600 block mb-1">Points to add / remove</label>
        <input x-model.number="modal.points" type="number"
          class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          placeholder="e.g. 500 or -200" />
      </div>
      <div class="mb-4">
        <label class="text-xs font-medium text-gray-600 block mb-1">Reason</label>
        <input x-model="modal.description" type="text"
          class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          placeholder="e.g. Birthday bonus" />
      </div>
      <div class="flex gap-2">
        <button @click="modal.open = false" class="flex-1 border py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        <button @click="submitAdjust()" class="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm hover:bg-violet-700">Apply</button>
      </div>
    </div>
  </div>

  <!-- ===== MODAL: Tier Form ===== -->
  <div x-show="tierModal.open" x-transition class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" @click.stop>
      <h3 class="font-semibold text-lg mb-4" x-text="tierModal.editing ? 'Edit Tier' : 'New Tier'"></h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Name</label>
          <input x-model="tierModal.form.name" type="text"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Min Points</label>
          <input x-model.number="tierModal.form.min_points" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Sort Order</label>
          <input x-model.number="tierModal.form.sort_order" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button @click="tierModal.open = false" class="flex-1 border py-2 rounded-lg text-sm">Cancel</button>
        <button @click="saveTier()" class="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm">Save</button>
      </div>
    </div>
  </div>

  <!-- ===== MODAL: Reward Form ===== -->
  <div x-show="rewardModal.open" x-transition class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md overflow-y-auto max-h-screen" @click.stop>
      <h3 class="font-semibold text-lg mb-4" x-text="rewardModal.editing ? 'Edit Reward Type' : 'New Reward Type'"></h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Name</label>
          <input x-model="rewardModal.form.name" type="text"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Description</label>
          <input x-model="rewardModal.form.description" type="text"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Discount Method</label>
          <select x-model="rewardModal.form.discount_method"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="flat">Flat Amount (€)</option>
            <option value="percent">Percentage (%)</option>
            <option value="shipping">Free Shipping</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Discount Target</label>
          <select x-model="rewardModal.form.discount_target"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="all">All Products</option>
            <option value="product">Specific Products</option>
            <option value="category">Product Category</option>
            <option value="vendor">Vendor / Brand</option>
            <option value="order_over">Order Over Amount</option>
          </select>
        </div>
        <div x-show="rewardModal.form.discount_method !== 'shipping'">
          <label class="text-xs font-medium text-gray-600 block mb-1">
            Value (<span x-text="rewardModal.form.discount_method === 'percent' ? 'hundredths, e.g. 1000 = 10%' : 'cents, e.g. 500 = €5'"></span>)
          </label>
          <input x-model.number="rewardModal.form.discount_value" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Points Cost (min points to claim)</label>
          <input x-model.number="rewardModal.form.min_points_cost" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="rewardModal.form.discount_target === 'order_over'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Min Order Amount (cents, e.g. 5000 = €50)</label>
          <input x-model.number="rewardModal.form.order_over_cents" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="rewardModal.form.discount_target === 'product'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Product IDs (comma-separated)</label>
          <input x-model="rewardModal.productIdsStr" type="text" placeholder="123, 456"
            class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="rewardModal.form.discount_target === 'category'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Category IDs (comma-separated)</label>
          <input x-model="rewardModal.categoryIdsStr" type="text" placeholder="10, 20"
            class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="rewardModal.form.discount_target === 'vendor'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Vendor IDs (comma-separated)</label>
          <input x-model="rewardModal.vendorIdsStr" type="text" placeholder="5, 8"
            class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" x-model="rewardModal.form.auto_apply" class="rounded" />
          Auto-apply (use for the default points-to-discount reward)
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" x-model="rewardModal.form.active" class="rounded" />
          Active
        </label>
      </div>
      <div class="flex gap-2 mt-4">
        <button @click="rewardModal.open = false" class="flex-1 border py-2 rounded-lg text-sm">Cancel</button>
        <button @click="saveReward()" class="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm">Save</button>
      </div>
    </div>
  </div>

  <!-- ===== MODAL: Rule Form ===== -->
  <div x-show="ruleModal.open" x-transition class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md overflow-y-auto max-h-screen" @click.stop>
      <h3 class="font-semibold text-lg mb-4" x-text="ruleModal.editing ? 'Edit Rule' : 'New Bonus Rule'"></h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Name</label>
          <input x-model="ruleModal.form.name" type="text"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Description</label>
          <input x-model="ruleModal.form.description" type="text"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-600 block mb-1">Type</label>
          <select x-model="ruleModal.form.type"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="product_ids">Specific Products</option>
            <option value="minimum_order">Minimum Order Value</option>
            <option value="multiplier">Points Multiplier</option>
            <option value="flat_bonus">Flat Bonus</option>
          </select>
        </div>
        <div x-show="ruleModal.form.type === 'product_ids'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Product IDs (comma-separated)</label>
          <input x-model="ruleModal.productIds" type="text" placeholder="123, 456"
            class="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="ruleModal.form.type === 'minimum_order'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Minimum Order (€)</label>
          <input x-model.number="ruleModal.minOrderEur" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="ruleModal.form.type === 'multiplier'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Multiplier</label>
          <input x-model.number="ruleModal.form.multiplier" type="number" step="0.1" min="1"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div x-show="ruleModal.form.type !== 'multiplier'">
          <label class="text-xs font-medium text-gray-600 block mb-1">Extra Points</label>
          <input x-model.number="ruleModal.form.extra_points" type="number"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs font-medium text-gray-600 block mb-1">Valid From</label>
            <input x-model="ruleModal.form.valid_from" type="date"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label class="text-xs font-medium text-gray-600 block mb-1">Valid Until</label>
            <input x-model="ruleModal.form.valid_until" type="date"
              class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" x-model="ruleModal.form.active" class="rounded" />
          Active
        </label>
      </div>
      <div class="flex gap-2 mt-4">
        <button @click="ruleModal.open = false" class="flex-1 border py-2 rounded-lg text-sm">Cancel</button>
        <button @click="saveRule()" class="flex-1 bg-violet-600 text-white py-2 rounded-lg text-sm">Save</button>
      </div>
    </div>
  </div>

  <!-- ===== MODAL: Customer Vouchers ===== -->
  <div x-show="voucherModal.open" x-transition class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg" @click.stop>
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-semibold text-lg">Voucher Codes</h3>
          <p class="text-sm text-gray-400" x-text="voucherModal.customer?.email"></p>
        </div>
        <button @click="voucherModal.open = false" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
      </div>
      <div class="space-y-2">
        <template x-for="v in voucherModal.vouchers" :key="v.id">
          <div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <div>
              <p class="text-sm font-medium" x-text="v.reward_types?.name ?? 'Reward'"></p>
              <p class="text-xs text-gray-400 mt-0.5">
                <span x-text="v.reward_types?.discount_method?.toUpperCase()"></span>
                <span x-show="v.reward_types?.discount_value"> ·
                  <span x-text="v.reward_types?.discount_method === 'percent'
                    ? (v.reward_types.discount_value/100).toFixed(0) + '%'
                    : '€' + (v.reward_types.discount_value/100).toFixed(2)"></span>
                </span>
              </p>
            </div>
            <div class="text-right">
              <p class="font-mono text-sm text-violet-600 font-semibold" x-text="v.voucher_code"></p>
              <span :class="{
                'bg-green-100 text-green-700': v.status === 'active',
                'bg-blue-100 text-blue-700': v.status === 'redeemed',
                'bg-gray-100 text-gray-500': v.status === 'expired',
              }" class="text-xs px-2 py-0.5 rounded-full font-medium" x-text="v.status"></span>
            </div>
          </div>
        </template>
        <p x-show="!voucherModal.vouchers?.length" class="text-center text-gray-400 text-sm py-6">No vouchers issued yet</p>
      </div>
    </div>
  </div>

</div>

<script>
function app() {
  const slug = window.location.pathname.split('/admin/')[1]?.replace(/\\/$/, '') || localStorage.getItem('loyalty_slug');
  const token = localStorage.getItem('loyalty_token');

  if (!token || !slug) {
    window.location.href = '/admin';
    return {};
  }

  return {
    slug,
    token,
    activeTab: 'overview',
    tabs: [
      { id: 'overview', label: 'Overview' },
      { id: 'customers', label: 'Customers' },
      { id: 'transactions', label: 'Transactions' },
      { id: 'tiers', label: 'Tiers' },
      { id: 'rewards', label: 'Rewards' },
      { id: 'rules', label: 'Bonus Rules' },
      { id: 'settings', label: 'Settings' },
    ],
    stats: {},
    customers: { data: [], total: 0, page: 1, size: 20 },
    transactions: { data: [], total: 0, page: 1, size: 30 },
    tiers: [],
    rewards: [],
    rules: [],
    settings: {},
    customerSearch: '',
    _bulkSyncing: false,
    patToken: '',
    toast: { msg: '', type: 'success' },
    modal: { open: false, customer: null, points: 0, description: '' },
    tierModal: { open: false, editing: false, form: {} },
    rewardModal: {
      open: false, editing: false, form: {},
      productIdsStr: '', categoryIdsStr: '', vendorIdsStr: '',
    },
    ruleModal: { open: false, editing: false, form: {}, productIds: '', minOrderEur: 0 },
    voucherModal: { open: false, customer: null, vouchers: [] },
    issuedVouchers: [],

    async init() {
      try {
        await Promise.all([
          this.loadStats(),
          this.loadSettings(),
          this.loadCustomers(1),
          this.loadTransactions(1),
          this.loadTiers(),
          this.loadRewards(),
          this.loadRules(),
        ]);
      } catch (e) {
        console.error('Dashboard init error:', e);
      }
    },

    notify(msg, type = 'success') {
      this.toast = { msg, type };
      setTimeout(() => this.toast.msg = '', type === 'error' ? 5000 : 4000);
    },

    async api(method, path, body) {
      const res = await fetch('/api/m/' + this.slug + '/admin' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) { this.logout(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      return data;
    },

    async loadStats() { this.stats = await this.api('GET', '/stats'); },
    async loadSettings() {
      this.settings = await this.api('GET', '/settings');
      try {
        const pat = await this.api('GET', '/pat-status');
        this.patToken = pat.has_token ? '••••••••' : '';
      } catch { /* ignore if endpoint not yet deployed */ }
    },
    async loadCustomers(page = 1) {
      const q = new URLSearchParams({ page, size: 20, search: this.customerSearch });
      const result = await this.api('GET', '/customers?' + q);
      for (const c of (result.data ?? [])) {
        c._syncing = false;
        c._syncDone = false;
        c._pointsDelta = 0;
        c._tierJustChanged = false;
      }
      this.customers = result;
    },
    async loadTransactions(page = 1) {
      this.transactions = await this.api('GET', '/transactions?page=' + page + '&size=30');
    },
    async loadTiers() { this.tiers = await this.api('GET', '/tiers'); },
    async loadRewards() {
      this.rewards = await this.api('GET', '/rewards');
      try { this.issuedVouchers = await this.api('GET', '/rewards/issued'); } catch { this.issuedVouchers = []; }
    },
    async loadRules() { this.rules = await this.api('GET', '/rules'); },

    async saveSettings() {
      try {
        await this.api('PATCH', '/settings', this.settings);
        this.notify('Settings saved');
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async savePatToken() {
      try {
        const val = this.patToken.trim();
        if (!val || val === '••••••••') { this.notify('Enter a PAT token first', 'error'); return; }
        await this.api('PATCH', '/pat-token', { cloudcart_pat_token: val });
        this.patToken = '••••••••';
        this.notify('PAT token saved — GraphQL API enabled');
      } catch (e) { this.notify(e.message, 'error'); }
    },

    openAdjust(cust) { this.modal = { open: true, customer: cust, points: 0, description: '' }; },
    async submitAdjust() {
      try {
        const r = await this.api('POST', '/customers/' + this.modal.customer.id + '/adjust', {
          points: this.modal.points, description: this.modal.description,
        });
        this.notify('Balance updated → ' + r.new_balance + ' pts');
        this.modal.open = false;
        await Promise.all([this.loadCustomers(this.customers.page), this.loadStats()]);
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async syncCustomer(cust) {
      if (cust._syncing) return;
      cust._syncing = true;
      cust._syncDone = false;
      cust._pointsDelta = 0;
      cust._tierJustChanged = false;
      try {
        const r = await this.api('POST', '/customers/' + cust.id + '/sync');
        if (!r) return;

        const awarded = r.points_awarded ?? 0;
        const oldBalance = cust.points_balance ?? 0;
        const oldTier = cust.tiers?.name ?? null;

        const updated = await this.api('GET', '/customers/' + cust.id);
        if (!updated) return;

        if (awarded > 0) {
          cust._pointsDelta = awarded;
          const newBal = r.new_balance ?? updated.points_balance ?? oldBalance;
          this.animateCount(cust, 'points_balance', oldBalance, newBal, 800);
          cust.lifetime_points = updated.lifetime_points ?? (oldBalance + awarded);
        } else {
          cust.points_balance = updated.points_balance ?? cust.points_balance;
          cust.lifetime_points = updated.lifetime_points ?? cust.lifetime_points;
        }

        if (updated.tiers?.name && updated.tiers.name !== oldTier) cust._tierJustChanged = true;
        cust.tiers = updated.tiers ?? null;
        cust.tier_id = updated.tier_id ?? null;
        cust.promo_code = updated.promo_code ?? cust.promo_code;
        cust.promo_code_cloudcart_id = updated.promo_code_cloudcart_id ?? cust.promo_code_cloudcart_id;

        this.$nextTick(() => {
          const row = document.getElementById('cust-row-' + cust.id);
          if (row) { row.classList.remove('row-synced'); void row.offsetWidth; row.classList.add('row-synced'); }
          const ptsEl = document.getElementById('pts-' + cust.id);
          if (ptsEl && awarded > 0) { ptsEl.classList.remove('points-updated'); void ptsEl.offsetWidth; ptsEl.classList.add('points-updated'); }
        });

        cust._syncDone = true;
        const msg = awarded > 0
          ? '+' + awarded.toLocaleString() + ' pts from ' + (r.orders_processed ?? 0) + ' order(s)' + (cust.tiers ? ' \\u00B7 ' + cust.tiers.name : '')
          : 'Already up to date \\u2014 no new orders';
        this.notify(msg);

        setTimeout(() => { cust._pointsDelta = 0; cust._syncDone = false; cust._tierJustChanged = false; }, 5000);
        this.loadStats();
      } catch (e) {
        this.notify(e.message || 'Sync failed', 'error');
      } finally {
        cust._syncing = false;
      }
    },

    async openVouchers(cust) {
      this.voucherModal = { open: true, customer: cust, vouchers: [] };
      try {
        this.voucherModal.vouchers = await this.api('GET', '/customers/' + cust.id + '/rewards');
      } catch { this.voucherModal.vouchers = []; }
    },

    animateCount(obj, prop, from, to, duration) {
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        obj[prop] = Math.round(from + (to - from) * eased);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    openTierForm(tier) {
      this.tierModal = {
        open: true, editing: !!tier,
        form: tier ? { ...tier } : { name: '', min_points: 0, sort_order: 0 },
      };
    },
    async saveTier() {
      try {
        if (this.tierModal.editing) await this.api('PATCH', '/tiers/' + this.tierModal.form.id, this.tierModal.form);
        else await this.api('POST', '/tiers', this.tierModal.form);
        this.notify('Tier saved');
        this.tierModal.open = false;
        await this.loadTiers();
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async deleteTier(id) {
      if (!confirm('Delete this tier?')) return;
      try { await this.api('DELETE', '/tiers/' + id); await this.loadTiers(); }
      catch (e) { this.notify(e.message, 'error'); }
    },

    openRewardForm(rw) {
      this.rewardModal = {
        open: true, editing: !!rw,
        productIdsStr: rw?.product_ids?.join(', ') ?? '',
        categoryIdsStr: rw?.category_ids?.join(', ') ?? '',
        vendorIdsStr: rw?.vendor_ids?.join(', ') ?? '',
        form: rw ? { ...rw } : {
          name: '', description: '', discount_method: 'flat', discount_target: 'all',
          discount_value: 0, min_points_cost: 0, order_over_cents: null,
          auto_apply: false, active: true, sort_order: 0,
        },
      };
    },
    async saveReward() {
      const form = { ...this.rewardModal.form };
      form.product_ids = this.rewardModal.productIdsStr.split(',').map(s => Number(s.trim())).filter(Boolean);
      form.category_ids = this.rewardModal.categoryIdsStr.split(',').map(s => Number(s.trim())).filter(Boolean);
      form.vendor_ids = this.rewardModal.vendorIdsStr.split(',').map(s => Number(s.trim())).filter(Boolean);
      try {
        if (this.rewardModal.editing) await this.api('PATCH', '/rewards/' + form.id, form);
        else await this.api('POST', '/rewards', form);
        this.notify('Reward saved');
        this.rewardModal.open = false;
        await this.loadRewards();
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async deleteReward(id) {
      if (!confirm('Delete this reward?')) return;
      try { await this.api('DELETE', '/rewards/' + id); await this.loadRewards(); }
      catch (e) { this.notify(e.message, 'error'); }
    },

    openRuleForm(rule) {
      this.ruleModal = {
        open: true, editing: !!rule,
        productIds: rule?.config?.product_ids?.join(', ') ?? '',
        minOrderEur: rule?.config?.min_order_eur ?? 0,
        form: rule ? { ...rule } : {
          name: '', description: '', type: 'flat_bonus',
          extra_points: 0, multiplier: 1, active: true,
          valid_from: null, valid_until: null, config: {},
        },
      };
    },
    async saveRule() {
      const form = { ...this.ruleModal.form };
      if (form.type === 'product_ids') form.config = { product_ids: this.ruleModal.productIds.split(',').map(s => Number(s.trim())).filter(Boolean) };
      else if (form.type === 'minimum_order') form.config = { min_order_eur: this.ruleModal.minOrderEur };
      else form.config = {};
      try {
        if (this.ruleModal.editing) await this.api('PATCH', '/rules/' + form.id, form);
        else await this.api('POST', '/rules', form);
        this.notify('Rule saved');
        this.ruleModal.open = false;
        await this.loadRules();
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async toggleRule(rule) {
      try { await this.api('PATCH', '/rules/' + rule.id, { active: !rule.active }); await this.loadRules(); }
      catch (e) { this.notify(e.message, 'error'); }
    },
    async deleteRule(id) {
      if (!confirm('Delete this rule?')) return;
      try { await this.api('DELETE', '/rules/' + id); await this.loadRules(); }
      catch (e) { this.notify(e.message, 'error'); }
    },

    async runSetup() {
      try {
        const r = await fetch('/api/m/' + this.slug + '/setup', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token },
        });
        const data = await r.json();
        alert(data.log.join('\\n') + (data.errors?.length ? '\\n\\nErrors:\\n' + data.errors.join('\\n') : ''));
        await this.loadTiers();
      } catch (e) { this.notify(e.message, 'error'); }
    },
    async syncExisting() {
      if (!confirm('Import all CloudCart customers and sync their order history?\\nThis may take a moment for stores with many customers.')) return;
      this._bulkSyncing = true;
      this.notify('Syncing all customers — this may take a moment…');
      try {
        const r = await fetch('/api/m/' + this.slug + '/setup/sync-existing', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + this.token },
        });
        const data = await r.json();
        const parts = [data.imported + ' customer(s) synced'];
        if (data.orders_processed > 0) parts.push(data.orders_processed + ' order(s) processed');
        if (data.points_awarded > 0) parts.push('+' + data.points_awarded.toLocaleString() + ' pts awarded');
        this.notify(parts.join(' · '));
        await this.loadCustomers(1);
        await this.loadStats();
      } catch (e) { this.notify(e.message, 'error'); }
      finally { this._bulkSyncing = false; }
    },

    logout() {
      localStorage.removeItem('loyalty_token');
      localStorage.removeItem('loyalty_slug');
      window.location.href = '/admin';
    },
  };
}
</script>
</body>
</html>`;
