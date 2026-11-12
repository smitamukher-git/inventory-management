import { ref, watch } from 'vue'

const STORAGE_KEY = 'restocking-submitted-orders'

// Read persisted orders. Any failure (storage blocked, bad JSON, wrong shape)
// degrades to an empty list rather than breaking the app.
function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Drop malformed entries so templates can rely on id/items being present
    return parsed.filter(o => o && typeof o.id === 'string' && Array.isArray(o.items))
  } catch (err) {
    console.warn('Unable to read submitted orders from localStorage:', err)
    return []
  }
}

// Module-level so every component shares the same list
const submittedOrders = ref(loadOrders())

watch(
  submittedOrders,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch (err) {
      console.warn('Unable to save submitted orders to localStorage:', err)
    }
  },
  { deep: true }
)

// Timestamp + random suffix: unique even for two submissions in the same millisecond
function generateId() {
  return `RST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export function useSubmittedOrders() {
  /**
   * @param {{items: Array, totalCost: number, leadTimeDays: number}} payload
   * @returns the stored order
   */
  const addSubmittedOrder = ({ items, totalCost, leadTimeDays }) => {
    const submittedAt = new Date()
    const expected = new Date(submittedAt.getTime() + leadTimeDays * 24 * 60 * 60 * 1000)
    const id = generateId()
    const order = {
      id,
      order_number: id,
      submitted_at: submittedAt.toISOString(),
      items,
      total_cost: totalCost,
      lead_time_days: leadTimeDays,
      expected_delivery: expected.toISOString()
    }
    // Newest first
    submittedOrders.value = [order, ...submittedOrders.value]
    return order
  }

  return { submittedOrders, addSubmittedOrder }
}
