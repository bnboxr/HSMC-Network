//! Regression coverage for hsmc-p2p public protocol exports.

use hsmc_p2p::NodeServices;

#[test]
fn node_services_is_public_and_constructible() {
    let services = NodeServices::NETWORK | NodeServices::RING_CT;

    assert_eq!(services.bits(), (1 << 0) | (1 << 20));
    assert!(services.contains(NodeServices::NETWORK));
    assert!(services.contains(NodeServices::RING_CT));
}
