var exec = require('cordova/exec');

var SERVICE = 'NosWidgets';

/**
 * NOS Native Widgets — JavaScript bridge.
 *
 * Consumed by an OutSystems 11 wrapper module as Client Actions.
 * See docs/plans/2026-06-02-os-native-widgets-design.md (§6) for the contract.
 */
var NosWidgets = {

    /**
     * One-time configuration. Call once after the app starts.
     * @param {{appGroup?: string, scheme?: string, apiBaseUrl?: string, refreshMinutes?: number}} options
     *   - scheme: deep-link URL scheme the widget uses (should match NosWidgetUrlScheme at build time)
     *   - refreshMinutes: background self-refresh cadence (Android enforces a 15-minute minimum)
     */
    configure: function (options, success, error) {
        exec(success, error, SERVICE, 'configure', [options || {}]);
    },

    /**
     * Push data from the app into the widget's shared storage and trigger a reload.
     * @param {{token?: string, payload: object}} data
     */
    writeData: function (data, success, error) {
        exec(success, error, SERVICE, 'writeData', [data || {}]);
    },

    /** Force the widget to reload now (Android: enqueue worker / iOS: reloadTimelines). */
    refreshNow: function (success, error) {
        exec(success, error, SERVICE, 'refreshNow', []);
    },

    /**
     * Subscribe to events emitted by the widget (e.g. a button tap routed to the app).
     * The success callback is kept alive and may fire multiple times.
     */
    onWidgetAction: function (callback, error) {
        exec(callback, error, SERVICE, 'onWidgetAction', []);
    },

    /** Resolve with whether at least one widget instance is placed on the home screen. */
    isWidgetAdded: function (success, error) {
        exec(success, error, SERVICE, 'isWidgetAdded', []);
    }
};

module.exports = NosWidgets;
