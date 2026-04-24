import * as Transaction from '@libs/actions/Transaction';
import type * as IOU from '@userActions/IOU';
import {replaceReceipt} from '@userActions/IOU/Receipt';
import {startSplitBill} from '@userActions/IOU/Split';
import * as TrackExpense from '@userActions/IOU/TrackExpense';
import CONST from '@src/CONST';
import type {ReceiptError} from '@src/types/onyx/Transaction';

export default function handleFileRetry(message: ReceiptError, file: File, dismissError: () => void, setShouldShowErrorModal: (value: boolean) => void) {
    const retryParams: IOU.ReplaceReceipt | IOU.StartSplitBilActionParams | TrackExpense.CreateTrackExpenseParams | IOU.RequestMoneyInformation =
        typeof message.retryParams === 'string'
            ? (JSON.parse(message.retryParams) as IOU.ReplaceReceipt | IOU.StartSplitBilActionParams | TrackExpense.CreateTrackExpenseParams | IOU.RequestMoneyInformation)
            : message.retryParams;

    const clearTransactionError = (transactionID?: string) => {
        if (!transactionID) {
            return false;
        }

        Transaction.clearError(transactionID);
        return true;
    };

    switch (message.action) {
        case CONST.IOU.ACTION_PARAMS.REPLACE_RECEIPT: {
            if (!clearTransactionError(message.transactionID)) {
                clearTransactionError((retryParams as IOU.ReplaceReceipt).transactionID);
            }
            const replaceReceiptParams = {...retryParams} as IOU.ReplaceReceipt;
            replaceReceiptParams.file = file;
            replaceReceipt(replaceReceiptParams);
            break;
        }
        case CONST.IOU.ACTION_PARAMS.START_SPLIT_BILL: {
            clearTransactionError(message.transactionID);
            const startSplitBillParams = {...retryParams} as IOU.StartSplitBilActionParams;
            startSplitBillParams.receipt = file;
            startSplitBillParams.shouldPlaySound = false;
            startSplitBill(startSplitBillParams);
            break;
        }
        case CONST.IOU.ACTION_PARAMS.TRACK_EXPENSE: {
            clearTransactionError(message.transactionID);
            const trackExpenseParams = {...retryParams} as TrackExpense.CreateTrackExpenseParams;
            trackExpenseParams.transactionParams.receipt = file;
            trackExpenseParams.isRetry = true;
            trackExpenseParams.shouldPlaySound = false;
            TrackExpense.trackExpense(trackExpenseParams);
            break;
        }
        case CONST.IOU.ACTION_PARAMS.MONEY_REQUEST: {
            clearTransactionError(message.transactionID);
            const requestMoneyParams = {...retryParams} as IOU.RequestMoneyInformation;
            requestMoneyParams.transactionParams.receipt = file;
            requestMoneyParams.isRetry = true;
            requestMoneyParams.shouldPlaySound = false;
            TrackExpense.requestMoney(requestMoneyParams);
            break;
        }
        default:
            dismissError();
            setShouldShowErrorModal(true);
            break;
    }
}
