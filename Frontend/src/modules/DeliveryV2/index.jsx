import DeliveryV2Router from './DeliveryV2Router';
import { DeliveryNotificationProvider } from '@food/context/DeliveryNotificationContext';
import DeliveryErrorBoundary from './components/DeliveryErrorBoundary';
import './deliveryTheme.css';

function DeliveryV2Module() {
	return (
		<DeliveryErrorBoundary>
			<DeliveryNotificationProvider>
				<div className="delivery-v2-theme">
					<DeliveryV2Router />
				</div>
			</DeliveryNotificationProvider>
		</DeliveryErrorBoundary>
	);
}

export default DeliveryV2Module;
