/**
 * Workaround for matter.js TLV decode crash when hub sends optional nested structs
 * (e.g. ProvideOffer.sFrameConfig) before the parent object exists.
 * @see https://github.com/project-chip/matter.js — ObjectSchema.injectField
 */
import { ObjectSchema } from '@matter/types/tlv';

const proto = ObjectSchema.prototype as {
    injectField: (
        value: Record<string, unknown> | undefined,
        fieldId: number,
        fieldValue: unknown,
        injectChecker: (v: unknown) => boolean,
    ) => Record<string, unknown>;
};

const original = proto.injectField;
proto.injectField = function (value, fieldId, fieldValue, injectChecker) {
    if (value === undefined || value === null) {
        value = {};
    }
    return original.call(this, value, fieldId, fieldValue, injectChecker);
};
