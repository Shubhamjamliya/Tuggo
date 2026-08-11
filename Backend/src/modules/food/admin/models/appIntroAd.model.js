import mongoose from 'mongoose';

const appIntroAdSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: false,
      trim: true,
    },
    mediaUrl: {
      type: String,
      required: true,
    },
    mediaType: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    duration: {
      type: Number, // duration in seconds
      default: 3,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    type: {
      type: String,
      enum: ["intro", "ad"],
      default: "ad",
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodRestaurant",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// We can add an index for order to sort them faster
appIntroAdSchema.index({ isActive: 1, order: 1 });

const AppIntroAd = mongoose.model("AppIntroAd", appIntroAdSchema);
export { AppIntroAd };
export default AppIntroAd;
