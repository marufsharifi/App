import {useCallback} from 'react';
import Onyx from 'react-native-onyx';
import type {OnyxUpdate} from 'react-native-onyx';
import {useSearchContext} from '@components/Search/SearchContext';
import {deleteMoneyRequestOnSearch} from '@libs/actions/Search';
import * as API from '@libs/API';
import {WRITE_COMMANDS} from '@libs/API/types';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Transaction} from '@src/types/onyx';
import type {RevertSplitTransactionParams} from '@libs/API/parameters/SplitTransactionParams';

function useSearchDeleteTransactions() {
    const {currentSearchResults} = useSearchContext();

    const deleteTransactionsOnSearch = useCallback(
        (hash: number, transactionIDs: string[]) => {
            if (!transactionIDs.length) {
                return;
            }

            const snapshotData = (currentSearchResults?.data ?? {}) as Record<string, unknown>;
            if (!Object.keys(snapshotData).length) {
                deleteMoneyRequestOnSearch(hash, transactionIDs);
                return;
            }

            const splitsByOriginalID: Record<string, string[]> = {};
            const nonSplitIDs: string[] = [];

            for (const transactionID of transactionIDs) {
                const transaction = snapshotData[`${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`] as Transaction | undefined;
                const originalTransactionID = transaction?.comment?.originalTransactionID;

                if (originalTransactionID && transaction?.comment?.source === CONST.IOU.TYPE.SPLIT) {
                    (splitsByOriginalID[originalTransactionID] ??= []).push(transactionID);
                } else {
                    nonSplitIDs.push(transactionID);
                }
            }

            for (const originalTransactionID of Object.keys(splitsByOriginalID)) {
                const deletingIDs = new Set(splitsByOriginalID[originalTransactionID]);

                const siblings: Transaction[] = [];
                for (const [key, value] of Object.entries(snapshotData)) {
                    if (!key.startsWith(ONYXKEYS.COLLECTION.TRANSACTION)) {
                        continue;
                    }
                    const t = value as Transaction | undefined;
                    if (!t?.transactionID) {
                        continue;
                    }
                    if (t.comment?.originalTransactionID !== originalTransactionID) {
                        continue;
                    }
                    if (deletingIDs.has(t.transactionID)) {
                        continue;
                    }
                    siblings.push(t);
                }

                if (siblings.length === 0) {
                    nonSplitIDs.push(...splitsByOriginalID[originalTransactionID]);
                    continue;
                }

                if (siblings.length === 1) {
                    const remaining = siblings[0];

                    // The split portion is typically stored in modifiedAmount for split children
                    const remainingPortion = Math.abs((remaining.modifiedAmount ?? remaining.amount ?? 0) as number);

                    const optimisticData: OnyxUpdate[] = [
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.SNAPSHOT}${hash}`,
                            value: {
                                data: {
                                    [`${ONYXKEYS.COLLECTION.TRANSACTION}${originalTransactionID}`]: null,
                                },
                            },
                        },
                    ];

                    const params: RevertSplitTransactionParams = {
                        transactionID: remaining.transactionID,
                        amount: remainingPortion,
                        created: remaining.created ?? '',
                        category: remaining.category ?? '',
                        tag: remaining.tag ?? '',
                        merchant: remaining.modifiedMerchant ?? remaining.merchant ?? '',
                        comment: remaining.comment?.comment ?? '',
                        reimbursable: remaining.reimbursable,
                        billable: remaining.billable,
                        reportID: remaining.reportID,
                    };

                    API.write(WRITE_COMMANDS.REVERT_SPLIT_TRANSACTION, params, {optimisticData, successData: [], failureData: []});
                    continue;
                }

                nonSplitIDs.push(...splitsByOriginalID[originalTransactionID]);
            }

            if (nonSplitIDs.length > 0) {
                deleteMoneyRequestOnSearch(hash, nonSplitIDs);
            }
        },
        [currentSearchResults?.data],
    );

    return {deleteTransactionsOnSearch};
}

export default useSearchDeleteTransactions;
