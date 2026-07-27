import { createSlice } from '@reduxjs/toolkit'
import { clearStoredUserLocation, clearStoredZoneContext, persistUserLocation, persistZoneContext } from '@food/utils/locationPersistence'

const initialState = {
  isLocationResolved: false,
  coords: null,
  zoneId: null,
  address: null,
}

const locationSlice = createSlice({
  name: 'location',
  initialState,
  reducers: {
    setLocation: (state, action) => {
      const { coords, zoneId, address } = action.payload
      state.coords = coords
      state.zoneId = zoneId
      state.address = address
      state.isLocationResolved = true

      if (zoneId) {
        persistZoneContext({ zoneId, status: 'IN_SERVICE' })
      } else {
        clearStoredZoneContext()
      }

      if (coords?.latitude && coords?.longitude) {
        persistUserLocation({
          ...coords,
          address: address || coords.address || '',
          formattedAddress: coords.formattedAddress || address || coords.address || '',
        })
      }
    },
    clearLocation: (state) => {
      state.coords = null
      state.zoneId = null
      state.address = null
      state.isLocationResolved = false
      clearStoredZoneContext()
      clearStoredUserLocation()
    }
  },
})

export const { setLocation, clearLocation } = locationSlice.actions
export default locationSlice.reducer
