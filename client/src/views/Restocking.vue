<template>
  <div class="restocking">
    <div class="page-header">
      <h2>{{ t('restocking.title') }}</h2>
      <p>{{ t('restocking.description') }}</p>
    </div>

    <div v-if="loading" class="loading">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else>
      <div v-if="placedOrder" class="success-banner" role="status">
        <span>{{ t('restocking.orderSuccess', { number: placedOrder.order_number, days: placedOrder.lead_time_days }) }}</span>
        <router-link to="/orders" class="success-link">{{ t('restocking.viewOrders') }}</router-link>
      </div>

      <div class="card budget-card">
        <div class="card-header">
          <h3 class="card-title">{{ t('restocking.budget') }}</h3>
          <button class="primary-button" :disabled="fundedItems.length === 0" @click="placeOrder">
            {{ t('restocking.placeOrder') }}
          </button>
        </div>

        <div class="budget-value">{{ currencySymbol }}{{ budget.toLocaleString() }}</div>
        <input
          v-model.number="budget"
          class="budget-slider"
          type="range"
          :min="BUDGET_MIN"
          :max="BUDGET_MAX"
          :step="BUDGET_STEP"
          :aria-label="t('restocking.budget')"
        />
        <div class="budget-scale">
          <span>{{ currencySymbol }}{{ BUDGET_MIN.toLocaleString() }}</span>
          <span>{{ currencySymbol }}{{ BUDGET_MAX.toLocaleString() }}</span>
        </div>

        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">{{ t('restocking.budgetUsed') }}</span>
            <strong>{{ formatMoney(budgetUsed) }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">{{ t('restocking.budgetRemaining') }}</span>
            <strong>{{ formatMoney(budgetRemaining) }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">{{ t('restocking.leadTime') }}</span>
            <strong>{{ fundedItems.length ? t('restocking.days', { count: orderLeadTime }) : '-' }}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">{{ t('restocking.fundedItems', { count: fundedItems.length }) }}</h3>
        </div>
        <div v-if="fundedItems.length === 0" class="empty-state">
          {{ allocations.length === 0 ? t('restocking.noShortfall') : t('restocking.noFunded') }}
        </div>
        <div v-else class="table-container">
          <table class="restock-table">
            <thead>
              <tr>
                <th>{{ t('restocking.table.item') }}</th>
                <th>{{ t('restocking.table.warehouse') }}</th>
                <th>{{ t('restocking.table.trend') }}</th>
                <th class="num">{{ t('restocking.table.shortfall') }}</th>
                <th class="num">{{ t('restocking.table.qty') }}</th>
                <th class="num">{{ t('restocking.table.unitCost') }}</th>
                <th class="num">{{ t('restocking.table.lineCost') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in fundedItems" :key="item.sku">
                <td>
                  <div class="item-name">{{ translateProductName(item.name) }}</div>
                  <div class="item-meta">{{ item.sku }}</div>
                </td>
                <td>{{ item.warehouse }}</td>
                <td>{{ trendLabel(item.trend) }}</td>
                <td class="num">{{ item.shortfall }}</td>
                <td class="num">
                  <strong>{{ item.qty }}</strong>
                  <span v-if="item.qty < item.shortfall" class="badge warning partial-badge">{{ t('restocking.partial') }}</span>
                </td>
                <td class="num">{{ formatMoney(item.unitCost) }}</td>
                <td class="num"><strong>{{ formatMoney(item.lineCost) }}</strong></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6" class="num">{{ t('restocking.orderTotal') }}</td>
                <td class="num"><strong>{{ formatMoney(budgetUsed) }}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div v-if="unfundedItems.length" class="card unfunded-card">
        <div class="card-header">
          <h3 class="card-title">{{ t('restocking.unfundedItems', { count: unfundedItems.length }) }}</h3>
        </div>
        <div class="table-container">
          <table class="restock-table muted">
            <thead>
              <tr>
                <th>{{ t('restocking.table.item') }}</th>
                <th>{{ t('restocking.table.warehouse') }}</th>
                <th>{{ t('restocking.table.trend') }}</th>
                <th class="num">{{ t('restocking.table.shortfall') }}</th>
                <th class="num">{{ t('restocking.table.qty') }}</th>
                <th class="num">{{ t('restocking.table.unitCost') }}</th>
                <th class="num">{{ t('restocking.table.lineCost') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in unfundedItems" :key="item.sku">
                <td>
                  <div class="item-name">{{ translateProductName(item.name) }}</div>
                  <div class="item-meta">{{ item.sku }}</div>
                </td>
                <td>{{ item.warehouse }}</td>
                <td>{{ trendLabel(item.trend) }}</td>
                <td class="num">{{ item.shortfall }}</td>
                <!-- Unfunded rows show what a full order would have been -->
                <td class="num">{{ item.shortfall }}</td>
                <td class="num">{{ formatMoney(item.unitCost) }}</td>
                <td class="num">{{ formatMoney(item.shortfall * item.unitCost) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useI18n } from '../composables/useI18n'
import { useSubmittedOrders } from '../composables/useSubmittedOrders'

// Full restock of every shortfall is ~$44.7K with current data, so $0-$50K
// lets the slider cover "nothing funded" through "everything funded".
const BUDGET_MIN = 0
const BUDGET_MAX = 50000
const BUDGET_STEP = 500
const BUDGET_DEFAULT = 10000

// Round to cents to avoid floating point drift when summing line costs
const round2 = (n) => Math.round(n * 100) / 100

export default {
  name: 'Restocking',
  setup() {
    const { t, currentCurrency, translateProductName } = useI18n()
    const { addSubmittedOrder } = useSubmittedOrders()

    const currencySymbol = computed(() => (currentCurrency.value === 'JPY' ? '¥' : '$'))

    const budget = ref(BUDGET_DEFAULT)
    const forecasts = ref([])
    const inventory = ref([])
    const loading = ref(true)
    const error = ref(null)
    const placedOrder = ref(null)

    const formatMoney = (value) => {
      return `${currencySymbol.value}${Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })}`
    }

    const trendLabel = (trend) => {
      const key = `restocking.trends.${trend}`
      const label = t(key)
      return label === key ? (trend || '-') : label
    }

    // Join forecasts to inventory by SKU; keep only items forecast to run short.
    // Sorted by shortfall units, biggest first (this is the funding priority).
    const candidates = computed(() => {
      const bySku = new Map(inventory.value.map(i => [i.sku, i]))
      return forecasts.value
        .map(f => {
          const stock = bySku.get(f.item_sku)
          if (!stock) return null
          const unitCost = Number(stock.unit_cost)
          const shortfall = Math.max(0, Number(f.forecasted_demand) - Number(stock.quantity_on_hand))
          if (!(unitCost > 0) || !(shortfall > 0)) return null
          return {
            sku: f.item_sku,
            name: f.item_name || stock.name,
            warehouse: stock.warehouse,
            trend: f.trend,
            shortfall,
            unitCost,
            // ESTIMATE only: lead time is derived from the reorder point, not supplier data.
            leadTimeDays: Math.max(7, Math.min(30, Math.ceil((stock.reorder_point || 25) / 10) + 8))
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.shortfall - a.shortfall)
    })

    // Greedy allocation in priority order. If an item doesn't fully fit we fund
    // floor(remaining / unitCost) units (if >= 1) and keep going, since cheaper
    // items further down the list may still fit in what's left.
    const allocations = computed(() => {
      let remaining = Number(budget.value) || 0
      return candidates.value.map(c => {
        const fullCost = round2(c.shortfall * c.unitCost)
        let qty = 0
        if (fullCost <= remaining) {
          qty = c.shortfall
        } else {
          qty = Math.floor(remaining / c.unitCost)
        }
        const lineCost = round2(qty * c.unitCost)
        remaining = round2(remaining - lineCost)
        return { ...c, qty, lineCost }
      })
    })

    const fundedItems = computed(() => allocations.value.filter(a => a.qty >= 1))
    const unfundedItems = computed(() => allocations.value.filter(a => a.qty < 1))

    const budgetUsed = computed(() => round2(fundedItems.value.reduce((s, i) => s + i.lineCost, 0)))
    const budgetRemaining = computed(() => round2((Number(budget.value) || 0) - budgetUsed.value))
    // Order arrives when its slowest item does
    const orderLeadTime = computed(() => Math.max(0, ...fundedItems.value.map(i => i.leadTimeDays)))

    const loadData = async () => {
      try {
        loading.value = true
        error.value = null
        const [f, inv] = await Promise.all([api.getDemandForecasts(), api.getInventory()])
        forecasts.value = Array.isArray(f) ? f : []
        inventory.value = Array.isArray(inv) ? inv : []
      } catch (err) {
        error.value = t('restocking.loadError') + ': ' + err.message
      } finally {
        loading.value = false
      }
    }

    const placeOrder = () => {
      if (fundedItems.value.length === 0) return
      placedOrder.value = addSubmittedOrder({
        items: fundedItems.value.map(i => ({
          sku: i.sku,
          name: i.name,
          quantity: i.qty,
          unit_cost: i.unitCost,
          line_cost: i.lineCost
        })),
        totalCost: budgetUsed.value,
        leadTimeDays: orderLeadTime.value
      })
    }

    onMounted(loadData)

    return {
      t,
      BUDGET_MIN,
      BUDGET_MAX,
      BUDGET_STEP,
      budget,
      loading,
      error,
      placedOrder,
      currencySymbol,
      formatMoney,
      trendLabel,
      translateProductName,
      allocations,
      fundedItems,
      unfundedItems,
      budgetUsed,
      budgetRemaining,
      orderLeadTime,
      placeOrder
    }
  }
}
</script>

<style scoped>
.card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.card-title {
  margin: 0;
  color: #0f172a;
}

.success-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 0.875rem 1.25rem;
  border: 1px solid #86efac;
  border-radius: 8px;
  background: #f0fdf4;
  color: #166534;
}

.success-link {
  color: #166534;
  font-weight: 600;
  text-decoration: underline;
  white-space: nowrap;
}

.budget-value {
  font-size: 2rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 0.75rem;
}

.budget-slider {
  width: 100%;
  accent-color: #0f172a;
}

.budget-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  color: #64748b;
  font-size: 0.8rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: #0f172a;
}

.summary-label {
  color: #64748b;
  font-size: 0.8rem;
}

.primary-button {
  padding: 0.6rem 1.25rem;
  border: 0;
  border-radius: 8px;
  background: #0f172a;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.primary-button:hover:not(:disabled) {
  background: #1e293b;
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-state {
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
  padding: 1rem;
}

.restock-table {
  width: 100%;
  border-collapse: collapse;
}

.restock-table th,
.restock-table td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.875rem;
  color: #0f172a;
}

.restock-table th {
  color: #64748b;
  font-weight: 600;
  font-size: 0.8rem;
}

.restock-table .num {
  text-align: right;
  white-space: nowrap;
}

.restock-table tfoot td {
  border-top: 2px solid #e2e8f0;
  border-bottom: none;
}

.restock-table.muted td {
  color: #94a3b8;
}

.restock-table.muted .item-name {
  color: #64748b;
}

.unfunded-card {
  background: #f8fafc;
}

.item-name {
  font-weight: 600;
}

.item-meta {
  color: #64748b;
  font-size: 0.8rem;
}

.partial-badge {
  margin-left: 0.5rem;
}

@media (max-width: 700px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
