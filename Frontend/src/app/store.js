import { configureStore } from '@reduxjs/toolkit'
import appReducer from './slices/appSlice'
import authReducer from './slices/authSlice'
import foodReducer from './slices/foodSlice'
import taxiReducer from './slices/taxiSlice'
import quickReducer from './slices/quickSlice'
import locationReducer from './slices/locationSlice'

export const store = configureStore({
  reducer: {
    app: appReducer,
    auth: authReducer,
    food: foodReducer,
    taxi: taxiReducer,
    quick: quickReducer,
    location: locationReducer,
  },
})

export const getStoreState = () => store.getState()

