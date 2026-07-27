import { useState, useEffect, useRef } from "react";
import { Plus, Edit, Trash2, GripVertical, Image as ImageIcon, Video, Loader2, Play } from "lucide-react";
import api from "@food/api";
import { getModuleToken } from "@food/utils/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog";
import { Input } from "@food/components/ui/input";
import { Label } from "@food/components/ui/label";
import { Button } from "@food/components/ui/button";
import { getMediaUrl } from "@/shared/utils/media";

const getAuthConfig = (additionalConfig = {}) => {
  const adminToken = getModuleToken('admin');
  return {
    ...additionalConfig,
    headers: {
      ...additionalConfig.headers,
      Authorization: `Bearer ${adminToken}`,
    },
  };
};

export default function AppIntroAds() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("intro"); // 'intro' or 'ad'

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentAdId, setCurrentAdId] = useState(null);

  const [formData, setFormData] = useState({
    title: "",
    duration: 3,
    type: "intro",
    isActive: true,
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchAds();
  }, []);

  const fetchAds = async () => {
    try {
      setLoading(true);
      const res = await api.get('/food/admin/app-intro-ads', getAuthConfig());
      if (res.data?.success) {
        setAds(res.data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch ads", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (ad = null, tab = activeTab) => {
    setError("");
    if (ad) {
      setIsEditing(true);
      setCurrentAdId(ad._id);
      setFormData({
        title: ad.title || "",
        duration: ad.duration || 3,
        type: ad.type || "intro",
        isActive: ad.isActive,
      });
      setPreviewUrl(getMediaUrl(ad.mediaUrl || ""));
      setSelectedFile(null);
    } else {
      setIsEditing(false);
      setCurrentAdId(null);
      setFormData({
        title: "",
        duration: 3,
        type: tab,
        isActive: true,
      });
      setPreviewUrl("");
      setSelectedFile(null);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError("Please select a valid image or video file.");
      return;
    }

    // Size check (max 15MB)
    if (file.size > 15 * 1024 * 1024) {
      setError("File size exceeds 15MB limit.");
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError("");
  };

  const handleSave = async () => {
    if (!isEditing && !selectedFile) {
      setError("Please select a media file.");
      return;
    }

    try {
      setIsSaving(true);
      setError("");

      const submitData = new FormData();
      submitData.append("title", formData.title);
      submitData.append("duration", formData.duration);
      submitData.append("type", formData.type);
      submitData.append("isActive", formData.isActive);

      if (selectedFile) {
        submitData.append("media", selectedFile);
        submitData.append("mediaType", selectedFile.type.startsWith("video/") ? "video" : "image");
      }

      let res;
      if (isEditing) {
        res = await api.patch(`/food/admin/app-intro-ads/${currentAdId}`, submitData, getAuthConfig({
          headers: { "Content-Type": "multipart/form-data" }
        }));
      } else {
        res = await api.post(`/food/admin/app-intro-ads`, submitData, getAuthConfig({
          headers: { "Content-Type": "multipart/form-data" }
        }));
      }

      if (res.data?.success) {
        setSuccess(`Screen ${isEditing ? 'updated' : 'added'} successfully!`);
        handleCloseModal();
        fetchAds();
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await api.patch(`/food/admin/app-intro-ads/${id}/toggle`, {}, getAuthConfig());
      fetchAds();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this screen?")) return;
    try {
      await api.delete(`/food/admin/app-intro-ads/${id}`, getAuthConfig());
      fetchAds();
      setSuccess("Screen deleted successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredAds = ads.filter(ad => ad.type === activeTab).sort((a, b) => a.order - b.order);

  const moveOrder = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === filteredAds.length - 1) return;

    const newAds = [...filteredAds];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    // Swap order values
    const tempOrder = newAds[index].order;
    newAds[index].order = newAds[targetIndex].order;
    newAds[targetIndex].order = tempOrder;

    try {
      await api.patch(`/food/admin/app-intro-ads/order`, {
        orders: [
          { id: newAds[index]._id, order: newAds[index].order },
          { id: newAds[targetIndex]._id, order: newAds[targetIndex].order }
        ]
      }, getAuthConfig());
      fetchAds();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">App Intro & Ads</h1>
            <p className="text-sm text-slate-500 mt-1">Manage welcome screens and promotional ads that appear when users open the app.</p>
          </div>
          <button
            onClick={() => handleOpenModal(null, activeTab)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add New {activeTab === 'intro' ? 'Intro Screen' : 'Ad'}
          </button>
        </div>

        {success && (
          <div className="mt-4 p-3 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm">
            {success}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("intro")}
          className={`pb-3 px-2 text-sm font-semibold transition-colors border-b-2 ${activeTab === "intro"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
        >
          Intro / Welcome Screens
        </button>
        <button
          onClick={() => setActiveTab("ad")}
          className={`pb-3 px-2 text-sm font-semibold transition-colors border-b-2 ${activeTab === "ad"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
        >
          Promotional Ads
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
            <p>Loading screens...</p>
          </div>
        ) : filteredAds.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <ImageIcon className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-lg font-medium text-slate-900 mb-1">No {activeTab === 'intro' ? 'Intro Screens' : 'Ads'} Found</p>
            <p className="text-sm">Click the "Add New" button to create one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-700">Order</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">Media</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">Title</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">Duration</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">Status</th>
                  <th className="px-6 py-4 font-semibold text-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAds.map((ad, index) => (
                  <tr key={ad._id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveOrder(index, 'up')}
                          disabled={index === 0}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <span className="font-mono text-slate-600 font-medium w-4 text-center">{index + 1}</span>
                        <button
                          onClick={() => moveOrder(index, 'down')}
                          disabled={index === filteredAds.length - 1}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="w-24 h-16 bg-slate-100 rounded-md overflow-hidden relative flex items-center justify-center border border-slate-200">
                        {ad.mediaType === 'video' ? (
                          <>
                            <video src={getMediaUrl(ad.mediaUrl)} className="w-full h-full object-cover opacity-80" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center">
                                <Play className="w-4 h-4 text-white ml-1" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img src={getMediaUrl(ad.mediaUrl)} alt={ad.title} className="w-full h-full object-cover" />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{ad.title || "Untitled"}</p>
                      <p className="text-xs text-slate-500 uppercase">{ad.type}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {ad.duration} sec
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggleStatus(ad._id)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ad.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ad.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(ad)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(ad._id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md bg-white p-6 rounded-2xl">
          <DialogHeader className="mb-2 pr-6">
            <DialogTitle className="text-xl font-bold text-slate-900">{isEditing ? "Edit Screen" : "Add New Screen"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <Label>Screen Type</Label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full mt-1 border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 border"
                disabled={isEditing}
              >
                <option value="intro">Intro / Welcome Screen</option>
                <option value="ad">Promotional Ad</option>
              </select>
            </div>

            <div>
              <Label>Title (Optional)</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Welcome to Tuggo Food Foods"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Duration (Seconds)</Label>
              <Input
                type="number"
                min="1"
                max="60"
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 1 })}
                className="mt-1"
              />
            </div>

            <div>
              <Label>Media (Image or Video)</Label>
              <div
                className="mt-1 border-2 border-dashed border-slate-300 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors relative"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*,video/*"
                  className="hidden"
                />

                {previewUrl ? (
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-slate-900 flex items-center justify-center">
                    {(selectedFile?.type.startsWith('video/') || (isEditing && formData.mediaType === 'video')) ? (
                      <video src={previewUrl} className="max-w-full max-h-full" controls />
                    ) : (
                      <img src={previewUrl} className="max-w-full max-h-full object-contain" alt="Preview" />
                    )}
                    <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                      Click to change
                    </div>
                  </div>
                ) : (
                  <div className="py-6 flex flex-col items-center text-slate-500">
                    <div className="flex gap-2 mb-2">
                      <ImageIcon className="w-8 h-8" />
                      <Video className="w-8 h-8" />
                    </div>
                    <span className="text-sm font-medium">Click to upload media</span>
                    <span className="text-xs mt-1 text-slate-400">Supports JPG, PNG, MP4 (Max 15MB)</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <Label htmlFor="isActive" className="cursor-pointer text-sm font-medium text-slate-700">Active</Label>
            </div>
          </div>

          <DialogFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={handleCloseModal} disabled={isSaving} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? "Update Screen" : "Save Screen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


